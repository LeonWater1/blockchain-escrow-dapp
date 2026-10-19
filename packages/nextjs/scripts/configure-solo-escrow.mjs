import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, isAddress, formatUnits, zeroAddress } from "viem";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const A = "0xb94007170a6c8ec8282b8e91f99cd83d99a05309";
const TOKEN = "0x399676ea415071b4064f0CefAaE22b2147f9B326";
const PREVIOUS_ESCROW = "0xa43db3d4d27fbd595ec44bea3f28273b1149dda3";
const DEFAULT_SELLER = "0x8C37ab3053E5aCB11181E9f4058b5Cd2eFe61d50";
const DEFAULT_ARBITER = "0xB5A286Ca94FcCffE9696457D97c29dF5C05d0919";
const inputs = process.argv.slice(2).map(value => value.trim());
const [seller, arbiter, deploymentHash] = inputs.length === 1
  ? [DEFAULT_SELLER, DEFAULT_ARBITER, inputs[0]]
  : inputs;
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();

function replaceOne(text, pattern, replacement, label) {
  if ((text.match(new RegExp(pattern.source, "g")) ?? []).length !== 1) {
    throw new Error(`${label} 未匹配到唯一位置，停止修改。`);
  }
  return text.replace(pattern, replacement);
}

async function main() {
  if (![seller, arbiter].every(address => address && isAddress(address, { strict: false }) && !same(address, zeroAddress))) {
    throw new Error("请填写两个有效的公开钱包地址：卖家 B、仲裁人 C。");
  }
  if (same(seller, arbiter) || same(seller, A) || same(arbiter, A)) throw new Error("A、B、C 必须是三个不同账户。");
  if (!/^0x[0-9a-fA-F]{64}$/.test(deploymentHash ?? "")) throw new Error("部署交易哈希应为 0x 开头的 64 位十六进制值。");

  const client = createPublicClient({ transport: http("https://rpc-testnet.potos.hk", { timeout: 60000 }) });
  if (await client.getChainId() !== 60600) throw new Error("RPC 网络不正确。");
  const receipt = await client.getTransactionReceipt({ hash: deploymentHash });
  if (receipt.status !== "success" || !receipt.contractAddress || receipt.to !== null) {
    throw new Error("该交易不是成功的合约创建交易，请核对部署交易哈希。");
  }
  if (!same(receipt.from, A)) throw new Error("请使用原买家 A 钱包部署，再填写相应部署交易哈希。");
  const address = receipt.contractAddress;
  if (same(address, PREVIOUS_ESCROW)) throw new Error("这仍是实验三旧 Escrow，请填写本次新部署交易哈希。");
  const deployment = JSON.parse(readFileSync(resolve(root, "packages/hardhat/deployments/potos_testnet/Escrow.json"), "utf8"));
  const actualArbiter = await client.readContract({ address, abi: deployment.abi, functionName: "arbiter" });
  if (!same(actualArbiter, arbiter)) throw new Error(`链上仲裁人是 ${actualArbiter}，与输入的 C 不符。`);
  const count = await client.readContract({ address, abi: deployment.abi, functionName: "orderCount" });
  const tokenAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }];
  const balance = await client.readContract({ address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [A] });

  const contractsPath = resolve(root, "packages/nextjs/contracts/deployedContracts.ts");
  const pagePath = resolve(root, "packages/nextjs/app/escrow/page.tsx");
  const originalContracts = readFileSync(contractsPath, "utf8");
  const originalPage = readFileSync(pagePath, "utf8");
  let contracts = replaceOne(originalContracts, /(Escrow:\s*\{\s*address:\s*")[^"]+(")/, (_, before, after) => `${before}${address}${after}`, "Escrow 地址");
  contracts = replaceOne(contracts, /(Escrow:\s*\{[\s\S]*?deployedOnBlock:\s*)\d+/, (_, before) => `${before}${receipt.blockNumber}`, "Escrow 部署区块");
  contracts = replaceOne(contracts, /(LRSToken:\s*\{\s*address:\s*")[^"]+(")/, (_, before, after) => `${before}${TOKEN}${after}`, "旧代币地址");
  let page = replaceOne(originalPage, /const ESCROW = "[^"]+";/, `const ESCROW = "${address}";`, "页面 Escrow 地址");
  page = replaceOne(page, /fromBlock:\s*\d+n,/, `fromBlock: ${receipt.blockNumber}n,`, "页面起始区块");
  page = replaceOne(page, /const \[seller, setSeller\] = useState\("[^"]*"\);/, `const [seller, setSeller] = useState("${seller.toLowerCase()}");`, "页面默认卖家");
  if (!page.includes(`const TOKEN = "${TOKEN}";`)) throw new Error("页面代币配置不是旧 LRSToken，停止修改。");

  const backup = resolve(root, "..", `escrow-solo-backup-${Date.now()}`);
  mkdirSync(backup, { recursive: true });
  copyFileSync(contractsPath, resolve(backup, "deployedContracts.ts"));
  copyFileSync(pagePath, resolve(backup, "page.tsx"));
  copyFileSync(resolve(root, "README.md"), resolve(backup, "README.md"));
  const config = {
    mode: "Three-wallet role verification",
    chainId: 60600, buyer: A, seller: seller.toLowerCase(), arbiter: arbiter.toLowerCase(), token: TOKEN,
    escrow: address, deployedOnBlock: Number(receipt.blockNumber), deploymentHash,
    configuredAt: new Date().toISOString(),
  };
  writeFileSync(contractsPath, contracts);
  writeFileSync(pagePath, page);
  writeFileSync(resolve(root, "packages/nextjs/contracts/soloEscrow.json"), JSON.stringify(config, null, 2) + "\n");
  const readme = `# Escrow 路线 B 用户前端

本项目使用三个不同钱包验证买家、卖家与仲裁人的权限和订单流程，地址与交易记录以链上实际结果为准。

## 运行

Node >=20.18.3，Yarn 3.2.3。执行 yarn install，然后 yarn start；打开 http://localhost:3000/escrow。
前端不需要新增环境变量或导入私钥；通过 MetaMask 切换三账户，连接 POTOS Testnet（60600）。
页面和实时日志均以 10 区块为一批查询。

## 当前配置

| 项目 | 值 |
| --- | --- |
| 买家 A | ${A} |
| 卖家 B | ${config.seller} |
| 仲裁人 C | ${config.arbiter} |
| 新 Escrow | ${address} |
| 新部署区块 | ${receipt.blockNumber} |
| 旧 LRSToken | ${TOKEN} |
| 代币精度 | 18 |

本次仅在 Remix 新部署 Escrow；旧代币继续使用。前端已同步到新地址，Hardhat deployments 中仍保留实验三原始部署记录，不是本次 Remix 部署记录。不要再运行 yarn deploy，否则会覆盖前端配置。恢复本次配置可重跑 configure-solo-escrow.mjs，并使用本次部署哈希。

## 成功交易记录

| 操作 | 实际订单编号 | 哈希 | 浏览器 | 发起账户 |
| --- | --- | --- | --- | --- |
| 新部署 Escrow | 不适用 | ${deploymentHash} | [查看](https://scan-testnet.potos.hk/tx/${deploymentHash}) | A |
| 第一笔 createOrder | 待操作 | 待记录 | 待记录 | A |
| 第一笔 approve | 待操作 | 待记录 | 待记录 | A |
| 第一笔 deposit | 待操作 | 待记录 | 待记录 | A |
| 第二笔 createOrder | 待操作 | 待记录 | 待记录 | A |
| 第二笔 approve | 待操作 | 待记录 | 待记录 | A |
| 第二笔 deposit | 待操作 | 待记录 | 待记录 | A |
| 第二笔 dispute | 待操作 | 待记录 | 待记录 | B |
| 第二笔 resolve(false) | 待操作 | 待记录 | 待记录 | C |
| 第一笔 confirm | 待操作 | 待记录 | 待记录 | A |

私钥和助记词不进入仓库。页面下方的成功交易列表刷新后清空，每次切换或刷新前保存记录。所有截图和解释题应使用本次实际地址、编号和哈希。
`;
  writeFileSync(resolve(root, "README.md"), readme);
  console.log(`配置成功\n新 Escrow: ${address}\n部署区块: ${receipt.blockNumber}\n仲裁人 C: ${actualArbiter}\n卖家 B: ${seller}\n旧代币: ${TOKEN}\nA 余额: ${formatUnits(balance, 18)} 个\n现有订单数: ${count}\n原配置备份: ${backup}`);
  if (balance < 60n * 10n ** 18n) console.log("A 余额不足两笔各30个，请先在旧代币合约中为A补足余额。");
}

main().catch(error => {
  console.error(error.shortMessage ?? error.message);
  process.exitCode = 1;
});
