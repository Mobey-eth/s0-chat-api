# @stage0/rns

Read-only utilities for `.rise` names on RISE Mainnet. The package includes a typed client for `https://rns.stage0.xyz/v1` and a Viem-based direct-onchain client.

```ts
import { createStage0RnsApiClient } from "@stage0/rns";

const rns = createStage0RnsApiClient();
const result = await rns.resolveName("mrbeast.rise");
console.log(result.address);
```

Direct onchain resolution:

```ts
import { createPublicClient, http } from "viem";
import { createStage0RnsOnchainClient, riseMainnet } from "@stage0/rns";

const publicClient = createPublicClient({
  chain: riseMainnet,
  transport: http(),
});
const rns = createStage0RnsOnchainClient(publicClient);
const result = await rns.resolveName("mrbeast.rise");
```

The initial package and API are intentionally read-only. They do not create registration quotes or transactions.
