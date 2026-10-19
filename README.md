# 区块链大作业：路线 B 订单托管前端

基于实验三项目增加 `/escrow` 用户页面，复用旧 LRSToken，使用本次新部署的 Escrow。页面支持创建订单、授权并付款、确认收货、发起争议与仲裁退款；所有交易由连接的 MetaMask 钱包签名。

仓库地址：[LeonWater1/blockchain-escrow-dapp](https://github.com/LeonWater1/blockchain-escrow-dapp)；本地原始项目来源为 [课程示例](https://github.com/kyonRay/my-first-dapp)。

## 成员与职责安排

| 成员 | 职责 | 工作量比例 |
| --- | --- | --- |
| 梁若水（组长，202430552535） | 合约及前端开发、部署配置、流程测试 | 40% |
| 张航立 | 仲裁逻辑审阅、测试结果核对 | 30% |
| 李尚彦 | 卖家流程检查、截图与材料整理 | 30% |

上述为工作职责分配。链上交易的实际签名账户以本文件交易表为准。

## 运行方法

要求 Node.js >= 20.18.3、Yarn 3.2.3，以及浏览器 MetaMask。下载本仓库后，在仓库根目录执行：

```bash
corepack enable
corepack prepare yarn@3.2.3 --activate
yarn install
yarn start
```

打开 [订单托管页面](http://localhost:3000/escrow)，通过 MetaMask 连接下表中的账户与 POTOS Testnet。页面已有合约地址与 ABI，运行现有前端无需重新部署、无需启动本地 Hardhat 链。

### 环境变量和网络

本次运行前端**不需要新增环境变量**，也不需要在代码或 `.env` 中填写钱包私钥、助记词。签名通过 MetaMask 完成。

只有自行重新部署合约时，才需要通过进程环境变量 `__RUNTIME_DEPLOYER_PRIVATE_KEY` 注入部署账户私钥。未设置时，测试网等远程网络不加载签名账户；编译与本地 Hardhat 测试仍可运行。源码不包含默认私钥，真实私钥不得写入代码、README 或提交到 Git 的 `.env` 文件。

| 项目 | 配置 |
| --- | --- |
| 网络 | POTOS Testnet |
| Chain ID | `60600` |
| RPC（公开地址） | `https://rpc-testnet.potos.hk` |
| 原生代币 | POT |
| 区块浏览器 | `https://scan-testnet.potos.hk` |

项目沿用 Scaffold-ETH 的公开默认客户端配置；本地 MetaMask 实验不要求另外申请 Alchemy 或 WalletConnect 凭据。若自行配置其他服务，真实凭据仅保留本地，不提交仓库。

## 本次合约与角色地址

| 项目 | 地址或数值 |
| --- | --- |
| 买家 A | `0xB94007170a6C8ec8282b8e91f99cD83D99A05309` |
| 卖家 B | `0x8C37ab3053E5aCB11181E9f4058b5Cd2eFe61d50` |
| 仲裁人 C | `0xB5A286Ca94FcCffE9696457D97c29dF5C05d0919` |
| 新 Escrow | `0x4Cd603d73BD3EfD4590ea41AcD356797C0F6b70B` |
| Escrow 部署区块 | `2671708` |
| 旧 LRSToken | `0x399676ea415071b4064f0CefAaE22b2147f9B326` |
| 名称 / 符号 | `LRSToken` / `LRS202430552535` |
| decimals | `18` |

本次在 Remix 新部署 Escrow，旧代币继续使用。`packages/nextjs/contracts/deployedContracts.ts` 与 `soloEscrow.json` 保存本次前端配置；`packages/hardhat/deployments/potos_testnet/` 保留实验三原始部署记录，其地址不代表本次新 Escrow。**不要为运行页面再次执行 `yarn deploy`**，该命令会覆盖前端的生成配置。

## 页面操作和权限

1. 连接 A，填写卖家 B、30 个代币、30 分钟、描述，创建第一笔订单。金额通过 `parseUnits(..., 18)` 转为链上最小单位，到期分钟数转换为秒级时间戳。
2. A 点击付款：先 `approve(Escrow, amount)`，等成功回执后再 `deposit(id)`。任一步拒签、失败或未返回哈希都会停止后续付款。
3. Paid 状态下，买家显示确认收货和争议按钮，卖家显示争议按钮。
4. 创建并支付第二笔订单，由 B 发起争议；只有合约中的 C 在 Disputed 状态下显示两个仲裁按钮。
5. C 对第二笔选择“退给买家”，A 对第一笔确认收货，最终分别为 Refunded 与 Completed。

订单 ID 从 `OrderCreated` 事件读取，每行再调用 `getOrder` 读取当前状态；不写死编号。历史和实时事件查询均按 10 区块分批，起始区块为 2671708。页面顶部根据连接地址、订单角色和链上仲裁人显示身份。前端控制按钮显示，合约修饰器与 `require` 执行最终权限检查。

## 已验证结果

截至核对区块 2671844，本合约共有 2 笔订单：

| 编号 | 描述 | 金额 | deadline | 最终状态 |
| --- | --- | --- | --- | --- |
| 0 | 页面订单 | 30 LRS | 1792393676 | Completed（2） |
| 1 | 页面争议订单 | 30 LRS | 1792394020 | Refunded（3） |

两笔金额均为 `30000000000000000000`。最终旧代币余额为 A 262、B 45、C 0、新 Escrow 0 LRS。本次确认收货从 Escrow 向 B 转出 30 LRS；本次退款从 Escrow 向 A 转回 30 LRS，不能把 B 的总余额 45 当成本次收入。

## 实际成功交易记录

以下 10 笔交易回执均为成功（status = 1）。approve 的订单编号按本次随后对应的付款记录关联。

| 操作 | 实际订单编号 | 区块 | 交易哈希 | 浏览器 | 发起账户 |
| --- | --- | --- | --- | --- | --- |
| 部署 Escrow | — | 2671708 | `0xe1551291ec2af751ee35210dd5f0dfb195c5896c3ea75751fefd1ec8592d5230` | [查看](https://scan-testnet.potos.hk/tx/0xe1551291ec2af751ee35210dd5f0dfb195c5896c3ea75751fefd1ec8592d5230) | A |
| 创建订单 createOrder | 0 | 2671769 | `0xe6ecd3ec3c64d6c0965223d7f1cbb332ca78fd77b2359cc583989e2e779002cf` | [查看](https://scan-testnet.potos.hk/tx/0xe6ecd3ec3c64d6c0965223d7f1cbb332ca78fd77b2359cc583989e2e779002cf) | A |
| 授权 approve | 0 | 2671774 | `0xda7e5bf820e31076a773142a099b8974f34a0283080f8dae71ead72f1342aa42` | [查看](https://scan-testnet.potos.hk/tx/0xda7e5bf820e31076a773142a099b8974f34a0283080f8dae71ead72f1342aa42) | A |
| 付款 deposit | 0 | 2671776 | `0xc66de546959505567dec229209c4879a98018213abfd42d1c6ff689c76d270d2` | [查看](https://scan-testnet.potos.hk/tx/0xc66de546959505567dec229209c4879a98018213abfd42d1c6ff689c76d270d2) | A |
| 创建订单 createOrder | 1 | 2671792 | `0xf42df73976ad97576fc9f264acdfcaa19d0cf5ee14f9d4fbd14824d17507105c` | [查看](https://scan-testnet.potos.hk/tx/0xf42df73976ad97576fc9f264acdfcaa19d0cf5ee14f9d4fbd14824d17507105c) | A |
| 授权 approve | 1 | 2671797 | `0xb354f833fd33874fe1ceb76eca8bf532fac50543570d9579e11efd9183894f1d` | [查看](https://scan-testnet.potos.hk/tx/0xb354f833fd33874fe1ceb76eca8bf532fac50543570d9579e11efd9183894f1d) | A |
| 付款 deposit | 1 | 2671798 | `0xb16b5dc931656653c698f1af1706ac177115e0c5f320199615a504e3e8ea6cb3` | [查看](https://scan-testnet.potos.hk/tx/0xb16b5dc931656653c698f1af1706ac177115e0c5f320199615a504e3e8ea6cb3) | A |
| 发起争议 dispute | 1 | 2671802 | `0x26f7d48287888af6737d1234facf542e9cbd28c5cafeb84062f7685e618697c6` | [查看](https://scan-testnet.potos.hk/tx/0x26f7d48287888af6737d1234facf542e9cbd28c5cafeb84062f7685e618697c6) | B |
| 退款裁决 resolve(false) | 1 | 2671821 | `0x9f5f1c276da93c659b96e298be881a3efaec748bb54bd233d25e66c9b6b7f1d8` | [查看](https://scan-testnet.potos.hk/tx/0x9f5f1c276da93c659b96e298be881a3efaec748bb54bd233d25e66c9b6b7f1d8) | C |
| 确认收货 confirm | 0 | 2671825 | `0xbb7be3fef332b03c6f389c6cdbff26516b157c109c9e0ba5ebb2c822bd45b56b` | [查看](https://scan-testnet.potos.hk/tx/0xbb7be3fef332b03c6f389c6cdbff26516b157c109c9e0ba5ebb2c822bd45b56b) | A |

退款裁决交易 `0x9f5f…f1d8` 的 From 为 C，参数为 `resolve(1, false)`；Logs 中旧 LRSToken 的 Transfer 为新 Escrow → A，value 为 `30000000000000000000`，同时产生 OrderResolved。确认收货交易 `0xbb7b…b56b` 则将 30 LRS 转给 B。

## 源码位置

| 文件 | 用途 |
| --- | --- |
| `packages/nextjs/app/escrow/page.tsx` | 路线 B 完整前端与权限按钮、交易顺序控制 |
| `packages/nextjs/components/Header.tsx` | 页面导航入口 |
| `packages/nextjs/hooks/scaffold-eth/useScaffoldEventHistory.ts` | 事件历史及实时查询分批处理 |
| `packages/nextjs/contracts/deployedContracts.ts` | 本次 Escrow 和旧代币地址及 ABI |
| `packages/nextjs/contracts/soloEscrow.json` | 本次公开角色与部署信息 |
| `packages/nextjs/scripts/configure-solo-escrow.mjs` | 根据公开部署交易核对并同步配置；重跑会重写 README |
| `packages/hardhat/contracts/Escrow.sol` | 订单状态机、买家/卖家/仲裁权限、代币托管 |
| `packages/hardhat/contracts/LRSToken.sol` | 实验二旧代币的合约源码 |
| `packages/hardhat/test/Escrow.ts` | 创建、付款、确认、超时退款与争议仲裁的测试 |
| `packages/hardhat/deploy/01_deploy_token.ts`、`02_deploy_escrow.ts` | 保留的实验三部署脚本，本次前端无需执行 |

类型检查及本地合约测试命令：

```bash
yarn next:check-types
yarn hardhat:test
```

`yarn hardhat:test` 显式使用本地 hardhat 测试网络，不使用 POTOS 账户发送交易。

## 截图索引

- 4B-1：完整 `escrow/page.tsx`，按屏分段。
- 4B-2：第一笔 Created 与付款按钮、approve 和 deposit 两个钱包确认弹窗。
- 4B-3：Paid 时 A 与 B 的不同按钮。
- 4B-4：争议后 A/B 页面及 C 的两个仲裁按钮。
- 4B-5：第一笔 Completed、第二笔 Refunded 的最终列表。
- 4B-6：退款裁决交易的 Details 和 Logs。

提交时保留实际截图与报告。页面底部交易记录为当前会话状态，刷新后需从已保存哈希或区块浏览器查回。

## 提交范围

提交源代码、公开合约配置、README 与必要依赖锁文件；真实 `.env`、私钥、助记词、`node_modules`、`.next`、Hardhat 缓存和构建产物不提交。合法的交易哈希同样是 `0x` 加 64 位十六进制，密钥检查时需结合字段含义区分，不能删除本表的真实交易哈希。
