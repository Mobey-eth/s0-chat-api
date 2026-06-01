import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MultipartFields } from "@fastify/multipart";
import { z } from "zod";
import { config } from "../config.js";
import {
  getCollectionImages,
  getImageAsset,
  getTokenImages,
  upsertCollectionImage,
  upsertTokenImage,
} from "../db.js";

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const uploadFieldSchema = z.object({
  chainId: z.coerce.number().int().positive(),
  address: z.string().regex(ADDRESS_RE),
});

const profileBodySchema = uploadFieldSchema.extend({
  description: z.string().max(1200).optional().nullable(),
  websiteUrl: z.string().max(2048).optional().nullable(),
  xUrl: z.string().max(2048).optional().nullable(),
  telegramUrl: z.string().max(2048).optional().nullable(),
  discordUrl: z.string().max(2048).optional().nullable(),
});

const lookupQuerySchema = z.object({
  chainId: z.coerce.number().int().positive(),
  addresses: z.string().min(1),
});

type ProjectProfileFields = {
  description?: string | null;
  websiteUrl?: string | null;
  xUrl?: string | null;
  telegramUrl?: string | null;
  discordUrl?: string | null;
};

type UploadErrorResult = {
  error: {
    code: number;
    payload: {
      error: string;
      detail?: string;
    };
  };
};

type UploadFileResult = {
  file: {
    chainId: number;
    address: string;
    buffer: Buffer;
    mimeType: string;
    sizeBytes: number;
    profile: ProjectProfileFields;
  };
};

function getFieldValue(fields: MultipartFields, key: string): string | undefined {
  const field = fields[key];
  if (!field || Array.isArray(field) || field.type !== "field") return undefined;
  return typeof field.value === "string" ? field.value : String(field.value ?? "");
}

function normalizeTextValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getProfileFieldsFromMultipart(fields: MultipartFields): ProjectProfileFields {
  return {
    description: normalizeTextValue(getFieldValue(fields, "description")),
    websiteUrl: normalizeTextValue(getFieldValue(fields, "websiteUrl")),
    xUrl: normalizeTextValue(getFieldValue(fields, "xUrl")),
    telegramUrl: normalizeTextValue(getFieldValue(fields, "telegramUrl")),
    discordUrl: normalizeTextValue(getFieldValue(fields, "discordUrl")),
  };
}

function getProfileFieldsFromBody(body: z.infer<typeof profileBodySchema>): ProjectProfileFields {
  return {
    description: normalizeTextValue(body.description),
    websiteUrl: normalizeTextValue(body.websiteUrl),
    xUrl: normalizeTextValue(body.xUrl),
    telegramUrl: normalizeTextValue(body.telegramUrl),
    discordUrl: normalizeTextValue(body.discordUrl),
  };
}

function imageUrlFor(id: string) {
  return `${config.apiPublicBaseUrl}/api/images/${id}`;
}

function formatMaxUploadSize() {
  return `${(config.uploadMaxBytes / (1024 * 1024)).toFixed(0)}MB`;
}

function isFileTooLargeError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return code === "FST_REQ_FILE_TOO_LARGE" || message.includes("file too large");
}

function parseAddresses(raw: string) {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((address) => ADDRESS_RE.test(address))
        .map((address) => address.toLowerCase()),
    ),
  );
}

function isUploadError(upload: UploadErrorResult | UploadFileResult): upload is UploadErrorResult {
  return "error" in upload;
}

async function readUpload(request: FastifyRequest): Promise<UploadErrorResult | UploadFileResult> {
  try {
    const upload = await request.file({
      limits: {
        fileSize: config.uploadMaxBytes,
        files: 1,
      },
    });

    if (!upload) {
      return { error: { code: 400, payload: { error: "missing_image", detail: "Attach one image file." } } };
    }

    if (!ACCEPTED_IMAGE_TYPES.has(upload.mimetype)) {
      return {
        error: {
          code: 415,
          payload: {
            error: "unsupported_image_type",
            detail: "Use a PNG, JPG, or WebP image.",
          },
        },
      };
    }

    const fields = upload.fields;
    const parsedFields = uploadFieldSchema.safeParse({
      chainId: getFieldValue(fields, "chainId"),
      address: getFieldValue(fields, "address"),
    });

    if (!parsedFields.success) {
      return {
        error: {
          code: 400,
          payload: {
            error: "invalid_upload_fields",
            detail: "Provide chainId and a valid project contract address.",
          },
        },
      };
    }

    const buffer = await upload.toBuffer();
    if (buffer.byteLength > config.uploadMaxBytes) {
      return {
        error: {
          code: 413,
          payload: {
            error: "image_too_large",
            detail: `Images must be ${formatMaxUploadSize()} or smaller.`,
          },
        },
      };
    }

    return {
      file: {
        ...parsedFields.data,
        buffer,
        mimeType: upload.mimetype,
        sizeBytes: buffer.byteLength,
        profile: getProfileFieldsFromMultipart(fields),
      },
    };
  } catch (error) {
    if (isFileTooLargeError(error)) {
      return {
        error: {
          code: 413,
          payload: {
            error: "image_too_large",
            detail: `Images must be ${formatMaxUploadSize()} or smaller.`,
          },
        },
      };
    }
    throw error;
  }
}

export async function registerImageRoutes(app: FastifyInstance) {
  app.post("/api/images/collections", async (request, reply) => {
    const upload = await readUpload(request);
    if (isUploadError(upload)) {
      return reply.code(upload.error.code).send(upload.error.payload);
    }

    const imageId = randomUUID();
    const image = await upsertCollectionImage({
      id: imageId,
      chainId: upload.file.chainId,
      collectionAddress: upload.file.address,
      imageUrl: imageUrlFor(imageId),
      imageMimeType: upload.file.mimeType,
      imageSizeBytes: upload.file.sizeBytes,
      imageData: upload.file.buffer,
      ...upload.file.profile,
    });

    return reply.send({ image });
  });

  app.put("/api/images/collections", async (request, reply) => {
    const parsed = profileBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_profile_fields",
        detail: "Provide chainId and a valid collection address.",
      });
    }

    const image = await upsertCollectionImage({
      id: randomUUID(),
      chainId: parsed.data.chainId,
      collectionAddress: parsed.data.address,
      ...getProfileFieldsFromBody(parsed.data),
    });

    return reply.send({ image });
  });

  app.post("/api/images/tokens", async (request, reply) => {
    const upload = await readUpload(request);
    if (isUploadError(upload)) {
      return reply.code(upload.error.code).send(upload.error.payload);
    }

    const imageId = randomUUID();
    const image = await upsertTokenImage({
      id: imageId,
      chainId: upload.file.chainId,
      tokenAddress: upload.file.address,
      imageUrl: imageUrlFor(imageId),
      imageMimeType: upload.file.mimeType,
      imageSizeBytes: upload.file.sizeBytes,
      imageData: upload.file.buffer,
      ...upload.file.profile,
    });

    return reply.send({ image });
  });

  app.put("/api/images/tokens", async (request, reply) => {
    const parsed = profileBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_profile_fields",
        detail: "Provide chainId and a valid token address.",
      });
    }

    const image = await upsertTokenImage({
      id: randomUUID(),
      chainId: parsed.data.chainId,
      tokenAddress: parsed.data.address,
      ...getProfileFieldsFromBody(parsed.data),
    });

    return reply.send({ image });
  });

  app.get("/api/images/collections", async (request, reply) => {
    const parsed = lookupQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_lookup_query",
        detail: "Provide chainId and comma-separated addresses.",
      });
    }

    const addresses = parseAddresses(parsed.data.addresses);
    const images = await getCollectionImages({ chainId: parsed.data.chainId, addresses });
    return reply.send({ images });
  });

  app.get("/api/images/tokens", async (request, reply) => {
    const parsed = lookupQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_lookup_query",
        detail: "Provide chainId and comma-separated addresses.",
      });
    }

    const addresses = parseAddresses(parsed.data.addresses);
    const images = await getTokenImages({ chainId: parsed.data.chainId, addresses });
    return reply.send({ images });
  });

  app.get("/api/images/:imageId", async (request, reply) => {
    const parsed = z.object({ imageId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) {
      return reply.code(404).send({ error: "image_not_found" });
    }

    const image = await getImageAsset(parsed.data.imageId);
    if (!image) {
      return reply.code(404).send({ error: "image_not_found" });
    }

    return reply
      .header("content-type", image.imageMimeType)
      .header("content-length", String(image.imageSizeBytes))
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(image.imageData);
  });
}
