import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { closeDb, pool } from "../db.js";

const registrarAbi = parseAbi([
  "function owner() view returns (address)",
  "function registry() view returns (address)",
  "function defaultResolver() view returns (address)",
  "function priceSigner() view returns (address)",
  "function effectivePolicy(string name) view returns (uint8)",
]);

const auctionHouseAbi = parseAbi(["function registrar() view returns (address)"]);
const marketplaceAbi = parseAbi([
  "function registry() view returns (address)",
  "function registrar() view returns (address)",
]);

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

function sameAddress(actual: Address, expected: string) {
  return actual.toLowerCase() === expected.toLowerCase();
}

function addCheck(checks: Check[], name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

async function main() {
  const client = createPublicClient({ transport: http(config.riseRpcUrl) });
  const checks: Check[] = [];
  const warnings: string[] = [];

  const [rpcChainId, head] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  addCheck(
    checks,
    "RPC chain",
    rpcChainId === config.riseChainId,
    `${config.riseNetworkName} (${rpcChainId}) at block ${head}`,
  );

  for (const [name, address] of Object.entries(config.rnsContracts)) {
    const bytecode = await client.getBytecode({ address: address as Address });
    addCheck(
      checks,
      `${name} bytecode`,
      Boolean(bytecode && bytecode !== "0x"),
      address,
    );
  }

  const registrar = config.rnsContracts.registrar as Address;
  const auctionHouse = config.rnsContracts.auctionHouse as Address;
  const marketplace = config.rnsContracts.marketplace as Address;
  const [
    registrarOwner,
    registrarRegistry,
    registrarResolver,
    registrarPriceSigner,
    auctionRegistrar,
    marketplaceRegistry,
    marketplaceRegistrar,
  ] = await Promise.all([
    client.readContract({ address: registrar, abi: registrarAbi, functionName: "owner" }),
    client.readContract({ address: registrar, abi: registrarAbi, functionName: "registry" }),
    client.readContract({ address: registrar, abi: registrarAbi, functionName: "defaultResolver" }),
    client.readContract({ address: registrar, abi: registrarAbi, functionName: "priceSigner" }),
    client.readContract({ address: auctionHouse, abi: auctionHouseAbi, functionName: "registrar" }),
    client.readContract({ address: marketplace, abi: marketplaceAbi, functionName: "registry" }),
    client.readContract({ address: marketplace, abi: marketplaceAbi, functionName: "registrar" }),
  ]);

  addCheck(
    checks,
    "Registrar owner",
    sameAddress(registrarOwner, config.rnsAdminAddress),
    registrarOwner,
  );
  addCheck(
    checks,
    "Registrar registry wiring",
    sameAddress(registrarRegistry, config.rnsContracts.registry),
    registrarRegistry,
  );
  addCheck(
    checks,
    "Registrar resolver wiring",
    sameAddress(registrarResolver, config.rnsContracts.resolver),
    registrarResolver,
  );
  addCheck(
    checks,
    "Auction registrar wiring",
    sameAddress(auctionRegistrar, config.rnsContracts.registrar),
    auctionRegistrar,
  );
  addCheck(
    checks,
    "Marketplace registry wiring",
    sameAddress(marketplaceRegistry, config.rnsContracts.registry),
    marketplaceRegistry,
  );
  addCheck(
    checks,
    "Marketplace registrar wiring",
    sameAddress(marketplaceRegistrar, config.rnsContracts.registrar),
    marketplaceRegistrar,
  );

  if (config.rnsPriceSignerPrivateKey) {
    const configuredSigner = privateKeyToAccount(config.rnsPriceSignerPrivateKey as Hex).address;
    addCheck(
      checks,
      "Quote signer",
      sameAddress(registrarPriceSigner, configuredSigner),
      `on-chain signer ${registrarPriceSigner}`,
    );
  } else {
    addCheck(checks, "Quote signer", false, "RNS_PRICE_SIGNER_PRIVATE_KEY is not configured");
  }

  for (const [name, startBlock] of Object.entries(config.rnsStartBlocks)) {
    addCheck(
      checks,
      `${name} start block`,
      startBlock <= head,
      `${startBlock} (head ${head})`,
    );
  }

  const inventoryResult = await pool.query<{
    testnet_count: string;
    mainnet_count: string;
    mainnet_enabled: string;
    mainnet_activated: string;
    missing_mainnet: string;
    invalid_enabled: string;
  }>(`
    select
      (select count(*) from stage0_rns.reserved_names where chain_id = 11155931) as testnet_count,
      (select count(*) from stage0_rns.reserved_names where chain_id = 4153) as mainnet_count,
      (select count(*) from stage0_rns.reserved_names where chain_id = 4153 and enabled) as mainnet_enabled,
      (select count(*) from stage0_rns.reserved_names where chain_id = 4153 and activated_at is not null) as mainnet_activated,
      (
        select count(*)
        from stage0_rns.reserved_names as source
        left join stage0_rns.reserved_names as mainnet
          on mainnet.chain_id = 4153
         and lower(mainnet.label) = lower(source.label)
        where source.chain_id = 11155931
          and mainnet.id is null
      ) as missing_mainnet,
      (
        select count(*)
        from stage0_rns.reserved_names
        where chain_id = 4153
          and enabled
          and (
            (sale_mode = 'auction' and coalesce(reserve_price_wei, 0) <= 0)
            or (sale_mode = 'buy_now' and coalesce(fixed_price_wei, 0) <= 0)
          )
      ) as invalid_enabled
  `);
  const inventory = inventoryResult.rows[0];
  const testnetCount = Number(inventory.testnet_count);
  const mainnetCount = Number(inventory.mainnet_count);
  addCheck(
    checks,
    "Reserved-name inventory",
    testnetCount > 0 && mainnetCount >= testnetCount && Number(inventory.missing_mainnet) === 0,
    `${mainnetCount} mainnet rows; ${inventory.mainnet_enabled} enabled; ${inventory.mainnet_activated} activated`,
  );
  addCheck(
    checks,
    "Reserved-name pricing",
    Number(inventory.invalid_enabled) === 0,
    `${inventory.invalid_enabled} enabled rows with invalid pricing`,
  );

  const reservedLabels = await pool.query<{ label: string }>(`
    select label
    from stage0_rns.reserved_names
    where chain_id = 4153
    order by display_order, label
  `);
  const openLabels: string[] = [];
  for (let offset = 0; offset < reservedLabels.rows.length; offset += 20) {
    const batch = reservedLabels.rows.slice(offset, offset + 20);
    const policies = await Promise.all(
      batch.map((row) =>
        client.readContract({
          address: registrar,
          abi: registrarAbi,
          functionName: "effectivePolicy",
          args: [row.label],
        }),
      ),
    );
    policies.forEach((policy, index) => {
      if (Number(policy) === 0) openLabels.push(batch[index].label);
    });
  }
  addCheck(
    checks,
    "Reserved-name on-chain policies",
    openLabels.length === 0,
    openLabels.length === 0
      ? `${reservedLabels.rowCount} labels are protected or sale-restricted`
      : `publicly open: ${openLabels.slice(0, 10).join(", ")}`,
  );

  const notificationColumn = await pool.query<{ is_nullable: "YES" | "NO" }>(`
    select is_nullable
    from information_schema.columns
    where table_schema = 'stage0_rns'
      and table_name = 'notification_dispatches'
      and column_name = 'chain_id'
  `);
  addCheck(
    checks,
    "Notification chain scope",
    notificationColumn.rows[0]?.is_nullable === "NO",
    notificationColumn.rows[0] ? "chain_id is required" : "chain_id column is missing",
  );

  const syncState = await pool.query<{ job_name: string; last_processed_block: string }>(`
    select job_name, last_processed_block
    from stage0_rns.sync_state
    where chain_id = 4153
    order by job_name
  `);
  if (syncState.rowCount === 0) {
    warnings.push("No mainnet sync cursors exist yet; start Senna once to begin indexing.");
  }

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }
  for (const warning of warnings) {
    console.log(`WARN ${warning}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    throw new Error(`${failed.length} mainnet readiness check(s) failed`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closeDb();
}
