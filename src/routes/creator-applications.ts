import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { MultipartFields } from "@fastify/multipart";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAddress, type Hex } from "viem";
import { z } from "zod";
import { config } from "../config.js";
import {
  buildCreatorAdminSessionMessage,
  verifyCreatorAdminSessionAuthorization,
  verifyCreatorApplicationAuthorization,
  type CreatorApplicationType,
} from "../creator-auth.js";
import {
  consumeCreatorAdminChallenge,
  createCreatorAdminChallenge,
  getCreatorAccess,
  getCreatorAdminChallenge,
  getCreatorAdminSession,
  getCreatorApplicationImage,
  listCreatorApplications,
  markCreatorApplicationNotification,
  revokeCreatorAdminSession,
  setCreatorApproval,
  takeRateLimit,
  upsertCreatorApplication,
  type CreatorTeamMember,
} from "../db.js";
import { logger } from "../logger.js";
import { notifyCreatorApplication } from "../creator-notifications.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SIGNATURE_RE = /^0x[a-fA-F0-9]{130}$/;
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CREATOR_ADMIN_COOKIE = "stage0_creator_admin_session";
const ADMIN_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null);
const teamMemberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
  x: optionalText(240).optional(),
  telegram: optionalText(240).optional(),
  discord: optionalText(240).optional(),
});
const projectDetailsSchema = z.record(z.string().max(80), z.string().trim().max(500)).refine(
  (value) => Object.keys(value).length <= 12,
  "Too many project detail fields.",
);

const applicationFieldsSchema = z.object({
  chainId: z.coerce.number().int().positive(),
  applicationType: z.enum(["nft", "presale"]),
  applicantWallet: z.string().regex(ADDRESS_RE),
  founderAddressInput: z.string().trim().min(1).max(120),
  founderName: z.string().trim().min(2).max(120),
  founderRole: z.string().trim().min(2).max(120),
  founderEmail: z.string().trim().email().max(320),
  founderX: optionalText(240),
  founderTelegram: optionalText(240),
  founderDiscord: optionalText(240),
  projectName: z.string().trim().min(2).max(160),
  projectDescription: z.string().trim().min(40).max(3000),
  projectStage: z.string().trim().min(1).max(120),
  projectWebsiteUrl: optionalText(2048),
  projectX: optionalText(240),
  projectTelegram: optionalText(240),
  projectDiscord: optionalText(240),
  projectDetails: z.string().transform((value, context) => {
    try {
      const parsed = projectDetailsSchema.safeParse(JSON.parse(value));
      if (!parsed.success) throw new Error("Invalid project details");
      return parsed.data;
    } catch {
      context.addIssue({ code: "custom", message: "Invalid project details" });
      return z.NEVER;
    }
  }),
  teamMembers: z.string().transform((value, context) => {
    try {
      const parsed = z.array(teamMemberSchema).max(10).safeParse(JSON.parse(value));
      if (!parsed.success) throw new Error("Invalid team members");
      return parsed.data;
    } catch {
      context.addIssue({ code: "custom", message: "Invalid team members" });
      return z.NEVER;
    }
  }),
  imageSha256: z.string().regex(HASH_RE),
  authAddress: z.string().regex(ADDRESS_RE),
  authTimestamp: z.coerce.number().int().positive(),
  authSignature: z.string().regex(SIGNATURE_RE),
});

const accessQuerySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  wallet: z.string().regex(ADDRESS_RE),
});

const imageParamsSchema = z.object({ id: z.string().uuid() });

const adminListQuerySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const adminSessionChallengeQuerySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  address: z.string().regex(ADDRESS_RE),
});

const adminSessionBodySchema = z.object({
  chainId: z.coerce.number().int().positive(),
  address: z.string().regex(ADDRESS_RE),
  challengeId: z.string().uuid(),
  signature: z.string().regex(SIGNATURE_RE),
});

const approvalBodySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  applicationType: z.enum(["nft", "presale"]),
  walletAddress: z.string().regex(ADDRESS_RE),
  approved: z.boolean(),
  applicationId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

function creatorAdminCookie(request: FastifyRequest) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== CREATOR_ADMIN_COOKIE) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function creatorAdminCookieHeader(token: string, maxAgeSeconds: number) {
  const secure = config.nodeEnv === "production" ? "; Secure" : "";
  return `${CREATOR_ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/api/admin/creator; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

function creatorAdminTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function requireCreatorAdminSession(request: FastifyRequest, chainId: number) {
  const token = creatorAdminCookie(request);
  if (!token) return null;
  const session = await getCreatorAdminSession(creatorAdminTokenHash(token));
  if (!session) return null;
  if (session.chainId !== chainId || session.adminAddress !== config.creatorAdminAddress) return null;
  return session;
}

function clearCreatorAdminCookie(reply: FastifyReply) {
  reply.header("set-cookie", creatorAdminCookieHeader("", 0));
}

function getFieldValue(fields: MultipartFields, key: string): string {
  const field = fields[key];
  if (!field || Array.isArray(field) || field.type !== "field") return "";
  return typeof field.value === "string" ? field.value : String(field.value ?? "");
}

function isFileTooLargeError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return code === "FST_REQ_FILE_TOO_LARGE" || message.includes("file too large");
}

function normalizeTeamMembers(members: z.infer<typeof teamMemberSchema>[]): CreatorTeamMember[] {
  return members.map((member) => ({
    name: member.name,
    role: member.role,
    ...(member.x ? { x: member.x } : {}),
    ...(member.telegram ? { telegram: member.telegram } : {}),
    ...(member.discord ? { discord: member.discord } : {}),
  }));
}

function buildApplicationPayload(input: z.infer<typeof applicationFieldsSchema>) {
  return {
    applicationType: input.applicationType,
    applicantWallet: input.applicantWallet.toLowerCase(),
    founderAddressInput: input.founderAddressInput,
    founderName: input.founderName,
    founderRole: input.founderRole,
    founderEmail: input.founderEmail.toLowerCase(),
    founderX: input.founderX,
    founderTelegram: input.founderTelegram,
    founderDiscord: input.founderDiscord,
    projectName: input.projectName,
    projectDescription: input.projectDescription,
    projectStage: input.projectStage,
    projectWebsiteUrl: input.projectWebsiteUrl,
    projectX: input.projectX,
    projectTelegram: input.projectTelegram,
    projectDiscord: input.projectDiscord,
    projectDetails: input.projectDetails,
    teamMembers: normalizeTeamMembers(input.teamMembers),
    imageSha256: input.imageSha256.toLowerCase(),
  };
}

function imageUrlFor(id: string) {
  return `${config.apiPublicBaseUrl}/api/creator-applications/${id}/image`;
}

function safeApplicationSummary(application: Awaited<ReturnType<typeof upsertCreatorApplication>>) {
  return {
    id: application.id,
    applicationType: application.applicationType,
    projectName: application.projectName,
    status: application.status,
    submittedAt: application.submittedAt,
  };
}

export async function registerCreatorApplicationRoutes(app: FastifyInstance) {
  app.get("/api/creator-access", async (request, reply) => {
    const parsed = accessQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_creator_access_query" });
    }
    const chainId = parsed.data.chainId ?? config.riseChainId;
    if (chainId !== config.riseChainId) {
      return reply.code(400).send({ error: "unsupported_chain" });
    }
    const access = await getCreatorAccess({ chainId, walletAddress: parsed.data.wallet });
    return reply.header("cache-control", "no-store").send({ chainId, access });
  });

  app.get("/api/creator-applications/:id/image", async (request, reply) => {
    const parsed = imageParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ error: "image_not_found" });
    const image = await getCreatorApplicationImage(parsed.data.id);
    if (!image) return reply.code(404).send({ error: "image_not_found" });
    return reply
      .header("content-type", image.imageMimeType)
      .header("content-length", String(image.imageSizeBytes))
      .header("cache-control", "private, max-age=86400")
      .header("x-robots-tag", "noindex, nofollow")
      .send(image.imageData);
  });

  app.post("/api/creator-applications", async (request: FastifyRequest, reply) => {
    try {
      const upload = await request.file({ limits: { fileSize: config.uploadMaxBytes, files: 1 } });
      if (!upload) {
        return reply.code(400).send({ error: "missing_project_image", detail: "Attach a project image." });
      }
      if (!ACCEPTED_IMAGE_TYPES.has(upload.mimetype)) {
        return reply.code(415).send({ error: "unsupported_image_type", detail: "Use PNG, JPG, or WebP." });
      }

      const parsed = applicationFieldsSchema.safeParse({
        ...Object.fromEntries(
          Object.keys(applicationFieldsSchema.shape).map((key) => [key, getFieldValue(upload.fields, key)]),
        ),
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_creator_application",
          detail: parsed.error.issues[0]?.message ?? "Check the required application fields.",
        });
      }
      if (parsed.data.chainId !== config.riseChainId) {
        return reply.code(400).send({ error: "unsupported_chain" });
      }

      const imageData = await upload.toBuffer();
      const imageHash = `0x${createHash("sha256").update(imageData).digest("hex")}`;
      if (imageHash !== parsed.data.imageSha256.toLowerCase()) {
        return reply.code(400).send({ error: "image_hash_mismatch", detail: "The signed image does not match the upload." });
      }

      const applicantWallet = getAddress(parsed.data.applicantWallet);
      if (applicantWallet.toLowerCase() !== parsed.data.authAddress.toLowerCase()) {
        return reply.code(401).send({ error: "application_wallet_mismatch" });
      }
      const payload = buildApplicationPayload(parsed.data);
      const authorized = await verifyCreatorApplicationAuthorization({
        chainId: parsed.data.chainId,
        timestamp: parsed.data.authTimestamp,
        address: applicantWallet,
        signature: parsed.data.authSignature as Hex,
        payload,
      });
      if (!authorized) {
        return reply.code(401).send({
          error: "invalid_application_authorization",
          detail: "Sign the application with the founder wallet supplied in the form.",
        });
      }

      const [ipWindow, walletWindow] = await Promise.all([
        takeRateLimit({ scope: "creator_application_ip", subject: request.ip, windowSeconds: 3600 }),
        takeRateLimit({ scope: "creator_application_wallet", subject: applicantWallet.toLowerCase(), windowSeconds: 3600 }),
      ]);
      if (ipWindow.hits > 8 || walletWindow.hits > 3) {
        return reply.code(429).send({ error: "application_rate_limited", detail: "Please wait before submitting again." });
      }

      const id = randomUUID();
      const application = await upsertCreatorApplication({
        id,
        chainId: parsed.data.chainId,
        applicationType: parsed.data.applicationType,
        applicantWallet,
        founderAddressInput: parsed.data.founderAddressInput,
        founderName: parsed.data.founderName,
        founderRole: parsed.data.founderRole,
        founderEmail: parsed.data.founderEmail,
        founderX: parsed.data.founderX,
        founderTelegram: parsed.data.founderTelegram,
        founderDiscord: parsed.data.founderDiscord,
        projectName: parsed.data.projectName,
        projectDescription: parsed.data.projectDescription,
        projectStage: parsed.data.projectStage,
        projectWebsiteUrl: parsed.data.projectWebsiteUrl,
        projectX: parsed.data.projectX,
        projectTelegram: parsed.data.projectTelegram,
        projectDiscord: parsed.data.projectDiscord,
        projectDetails: parsed.data.projectDetails,
        teamMembers: normalizeTeamMembers(parsed.data.teamMembers),
        imageUrl: imageUrlFor(id),
        imageMimeType: upload.mimetype,
        imageSizeBytes: imageData.byteLength,
        imageData,
      });

      const notification = await notifyCreatorApplication(application);
      await markCreatorApplicationNotification({
        id: application.id,
        status: notification.status,
        error: notification.error,
      });
      if (notification.error) {
        logger.error("Creator application notification incomplete", {
          applicationId: application.id,
          status: notification.status,
          error: notification.error,
        });
      }

      return reply.code(201).send({ ok: true, application: safeApplicationSummary(application) });
    } catch (error) {
      if (isFileTooLargeError(error)) {
        return reply.code(413).send({ error: "image_too_large", detail: "Project images must be 2MB or smaller." });
      }
      throw error;
    }
  });

  app.get("/api/admin/creator-session/challenge", async (request, reply) => {
    const parsed = adminSessionChallengeQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_admin_session_request" });
    const chainId = parsed.data.chainId ?? config.riseChainId;
    if (chainId !== config.riseChainId) return reply.code(400).send({ error: "unsupported_chain" });

    const adminAddress = getAddress(parsed.data.address);
    if (adminAddress.toLowerCase() !== config.creatorAdminAddress) {
      return reply.code(403).send({ error: "creator_admin_required" });
    }

    const challenge = {
      id: randomUUID(),
      chainId,
      adminAddress: adminAddress.toLowerCase(),
      nonce: `0x${randomBytes(32).toString("hex")}`,
      expiresAt: new Date(Date.now() + ADMIN_CHALLENGE_TTL_MS).toISOString(),
    };
    await createCreatorAdminChallenge(challenge);
    return reply.header("cache-control", "no-store").send({
      challenge: {
        id: challenge.id,
        chainId,
        address: adminAddress,
        expiresAt: challenge.expiresAt,
        message: buildCreatorAdminSessionMessage({
          chainId,
          adminAddress: challenge.adminAddress,
          challengeId: challenge.id,
          nonce: challenge.nonce,
          expiresAt: challenge.expiresAt,
        }),
      },
    });
  });

  app.post("/api/admin/creator-session", async (request, reply) => {
    const parsed = adminSessionBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_admin_session_request" });
    if (parsed.data.chainId !== config.riseChainId) {
      return reply.code(400).send({ error: "unsupported_chain" });
    }

    const adminAddress = getAddress(parsed.data.address);
    const challenge = await getCreatorAdminChallenge(parsed.data.challengeId);
    if (
      !challenge
      || challenge.chainId !== parsed.data.chainId
      || challenge.adminAddress !== adminAddress.toLowerCase()
    ) {
      return reply.code(401).send({ error: "invalid_or_expired_admin_challenge" });
    }

    const authorized = await verifyCreatorAdminSessionAuthorization({
      chainId: challenge.chainId,
      adminAddress,
      challengeId: challenge.id,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      signature: parsed.data.signature as Hex,
    });
    if (!authorized) return reply.code(401).send({ error: "invalid_admin_authorization" });

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString();
    const created = await consumeCreatorAdminChallenge({
      challengeId: challenge.id,
      chainId: challenge.chainId,
      adminAddress,
      tokenHash: creatorAdminTokenHash(token),
      sessionExpiresAt: expiresAt,
    });
    if (!created) return reply.code(401).send({ error: "invalid_or_expired_admin_challenge" });

    return reply
      .header("set-cookie", creatorAdminCookieHeader(token, Math.floor(ADMIN_SESSION_TTL_MS / 1_000)))
      .header("cache-control", "no-store")
      .send({ ok: true, expiresAt });
  });

  app.delete("/api/admin/creator-session", async (request, reply) => {
    const token = creatorAdminCookie(request);
    if (token) await revokeCreatorAdminSession(creatorAdminTokenHash(token));
    clearCreatorAdminCookie(reply);
    return reply.header("cache-control", "no-store").send({ ok: true });
  });

  app.get("/api/admin/creator-applications", async (request, reply) => {
    const parsed = adminListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_admin_request" });
    const chainId = parsed.data.chainId ?? config.riseChainId;
    if (chainId !== config.riseChainId) return reply.code(400).send({ error: "unsupported_chain" });

    const session = await requireCreatorAdminSession(request, chainId);
    if (!session) {
      clearCreatorAdminCookie(reply);
      return reply.code(401).send({ error: "creator_admin_session_required" });
    }

    const applications = await listCreatorApplications({
      chainId,
      status: parsed.data.status,
      limit: parsed.data.limit,
    });
    return reply.header("cache-control", "no-store").send({ chainId, applications });
  });

  app.post("/api/admin/creator-approvals", async (request, reply) => {
    const parsed = approvalBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_creator_approval", detail: parsed.error.issues[0]?.message });
    }
    const chainId = parsed.data.chainId ?? config.riseChainId;
    if (chainId !== config.riseChainId) return reply.code(400).send({ error: "unsupported_chain" });

    const session = await requireCreatorAdminSession(request, chainId);
    if (!session) {
      clearCreatorAdminCookie(reply);
      return reply.code(401).send({ error: "creator_admin_session_required" });
    }

    const walletAddress = getAddress(parsed.data.walletAddress);
    const access = await setCreatorApproval({
      chainId,
      applicationType: parsed.data.applicationType,
      walletAddress,
      approved: parsed.data.approved,
      approvedBy: session.adminAddress,
      applicationId: parsed.data.applicationId,
      notes: parsed.data.notes,
    });
    return reply.send({ ok: true, walletAddress, access });
  });
}
