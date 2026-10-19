"use client";

import { useRef, useState } from "react";
import { getAccount, readContract } from "@wagmi/core";
import { Address, Hash, decodeEventLog, formatUnits, isAddress, parseUnits, zeroAddress } from "viem";
import { useAccount, useConfig } from "wagmi";
import {
  useDeployedContractInfo,
  useScaffoldEventHistory,
  useScaffoldReadContract,
  useScaffoldWriteContract,
} from "~~/hooks/scaffold-eth";

const CHAIN_ID = 60600;
const TOKEN = "0x399676ea415071b4064f0CefAaE22b2147f9B326";
const ESCROW = "0x4Cd603d73BD3EfD4590ea41AcD356797C0F6b70B";
const STATUS = ["Created", "Paid", "Completed", "Refunded", "Disputed"];
const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
type Action = "pay" | "confirm" | "dispute" | "sellerWins" | "buyerWins";
type RecordItem = { operation: string; id: string; hash: Hash; caller: Address };

function OrderRow({
  id,
  address,
  arbiter,
  disabled,
  act,
}: {
  id: bigint;
  address?: Address;
  arbiter?: Address;
  disabled: boolean;
  act: (id: bigint, action: Action) => void;
}) {
  const { data: order, error } = useScaffoldReadContract({
    contractName: "Escrow",
    functionName: "getOrder",
    args: [id],
    chainId: CHAIN_ID,
  });
  if (!order)
    return (
      <tr>
        <td colSpan={7}>
          订单 #{id.toString()}：{error ? "读取失败，请刷新重试" : "读取中…"}
        </td>
      </tr>
    );
  const buyer = same(address, order.buyer);
  const seller = same(address, order.seller);
  const paid = order.status === 1;
  return (
    <tr>
      <td>#{id.toString()}</td>
      <td>
        <div>
          买家：<span className="break-all">{order.buyer}</span>
        </div>
        <div>
          卖家：<span className="break-all">{order.seller}</span>
        </div>
      </td>
      <td>
        <div>{formatUnits(order.amount, 18)} 个</div>
        <div className="text-xs break-all">{order.token}</div>
        {!same(order.token, TOKEN) && <div className="text-warning">其他代币，付款请另行核对</div>}
      </td>
      <td>{new Date(Number(order.deadline) * 1000).toLocaleString()}</td>
      <td className="break-words">{order.description}</td>
      <td className="font-semibold">{STATUS[order.status]}</td>
      <td>
        <div className="flex flex-col gap-2">
          {buyer && order.status === 0 && same(order.token, TOKEN) && (
            <button className="btn btn-primary btn-sm" disabled={disabled} onClick={() => act(id, "pay")}>
              付款（授权后付款）
            </button>
          )}
          {buyer && paid && (
            <button className="btn btn-primary btn-sm" disabled={disabled} onClick={() => act(id, "confirm")}>
              确认收货
            </button>
          )}
          {(buyer || seller) && paid && (
            <button className="btn btn-warning btn-sm" disabled={disabled} onClick={() => act(id, "dispute")}>
              争议
            </button>
          )}
          {same(address, arbiter) && order.status === 4 && (
            <>
              <button className="btn btn-primary btn-sm" disabled={disabled} onClick={() => act(id, "sellerWins")}>
                判给卖家
              </button>
              <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => act(id, "buyerWins")}>
                退给买家
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function EscrowPage() {
  const { address, chainId } = useAccount();
  const config = useConfig();
  const { data: escrow } = useDeployedContractInfo({ contractName: "Escrow", chainId: CHAIN_ID });
  const { data: token } = useDeployedContractInfo({ contractName: "LRSToken", chainId: CHAIN_ID });
  const { data: arbiter } = useScaffoldReadContract({
    contractName: "Escrow",
    functionName: "arbiter",
    chainId: CHAIN_ID,
  });
  const { data: orderCount } = useScaffoldReadContract({
    contractName: "Escrow",
    functionName: "orderCount",
    chainId: CHAIN_ID,
  });
  const { data: balance } = useScaffoldReadContract({
    contractName: "LRSToken",
    functionName: "balanceOf",
    args: [address],
    chainId: CHAIN_ID,
  });
  const {
    data: created,
    error: eventsError,
    isLoading,
    isFetchingNewEvent,
  } = useScaffoldEventHistory({
    contractName: "Escrow",
    eventName: "OrderCreated",
    chainId: CHAIN_ID,
    fromBlock: 2671708n,
    blocksBatchSize: 10,
    watch: true,
  });
  const { writeContractAsync: writeEscrow } = useScaffoldWriteContract({ contractName: "Escrow", chainId: CHAIN_ID });
  const { writeContractAsync: writeToken } = useScaffoldWriteContract({ contractName: "LRSToken", chainId: CHAIN_ID });
  const [seller, setSeller] = useState("0x8c37ab3053e5acb11181e9f4058b5cd2efe61d50");
  const [amount, setAmount] = useState("30");
  const [minutes, setMinutes] = useState("30");
  const [description, setDescription] = useState("页面订单");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const correctlyConfigured = same(escrow?.address, ESCROW) && same(token?.address, TOKEN);
  const disabled = busy || !address || chainId !== CHAIN_ID || !correctlyConfigured;
  const ids = [...new Set((created ?? []).flatMap(event => (event.args.id === undefined ? [] : [event.args.id])))].sort(
    (a, b) => (a < b ? 1 : a > b ? -1 : 0),
  );
  const roles = [
    same(address, arbiter) ? "仲裁人" : "",
    created?.some(event => same(address, event.args.buyer)) ? "买家" : "",
    created?.some(event => same(address, event.args.seller)) ? "卖家" : "",
  ].filter(Boolean);

  // 每次签名前核对钱包，避免两笔付款之间切换账户后误操作。
  function assertWallet(expected?: Address) {
    const current = getAccount(config);
    if (!expected || !same(current.address, expected) || current.chainId !== CHAIN_ID) {
      throw new Error("钱包账户或网络已变化，请切回原账户及 POTOS Testnet 后重试。");
    }
    if (!correctlyConfigured) throw new Error("合约配置与本次实验不一致，请核对 deployedContracts.ts。");
  }

  async function perform(action: (caller: Address) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      assertWallet(address);
      await action(address!);
    } catch (e) {
      const detail = e as { shortMessage?: string; message?: string };
      setError(detail.shortMessage ?? detail.message ?? "交易未完成，请查看 MetaMask 和浏览器控制台。");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  function save(operation: string, id: string, hash: Hash | undefined, caller: Address) {
    if (!hash) throw new Error("交易未发送，已停止后续操作。");
    setRecords(previous => [...previous, { operation, id, hash, caller }]);
  }

  async function createOrder() {
    await perform(async caller => {
      if (!isAddress(seller, { strict: false }) || same(seller, zeroAddress) || same(seller, caller)) {
        throw new Error("卖家必须是有效地址，且不能是零地址或买家本人。");
      }
      if (!/^\d+(\.\d{1,18})?$/.test(amount) || parseUnits(amount, 18) <= 0n) {
        throw new Error("金额必须大于 0，最多保留 18 位小数。");
      }
      if (
        !/^\d+$/.test(minutes) ||
        !Number.isSafeInteger(Number(minutes)) ||
        Number(minutes) < 1 ||
        Number(minutes) > 525600
      ) {
        throw new Error("到期分钟数请填写 1 到 525600 的整数。");
      }
      const deadline = BigInt(Math.floor(Date.now() / 1000)) + BigInt(minutes) * 60n;
      let newId = "";
      setMessage("请在 MetaMask 确认创建订单，等待链上成功后再继续。");
      const hash = await writeEscrow(
        {
          functionName: "createOrder",
          args: [seller as Address, TOKEN, parseUnits(amount, 18), deadline, description],
        },
        {
          onBlockConfirmation: receipt => {
            for (const log of receipt.logs) {
              if (!same(log.address, ESCROW)) continue;
              try {
                const event = decodeEventLog({
                  abi: escrow!.abi,
                  eventName: "OrderCreated",
                  data: log.data,
                  topics: log.topics,
                });
                newId = event.args.id.toString();
              } catch {
                /* 忽略其他事件，只提取本次创建的订单编号。 */
              }
            }
          },
        },
      );
      save("createOrder", newId || "见订单列表", hash, caller);
      setMessage(`创建成功，订单 #${newId || "待同步"}。列表可能需等待一轮同步，请勿重复创建。`);
    });
  }

  async function act(id: bigint, action: Action) {
    await perform(async caller => {
      if (action === "pay") {
        // getOrder 重新读取，授权金额以链上订单为准。
        const currentOrder = await readContract(config, {
          address: ESCROW,
          abi: escrow!.abi,
          functionName: "getOrder",
          args: [id],
          chainId: CHAIN_ID,
        });
        if (!same(currentOrder.buyer, caller) || currentOrder.status !== 0 || !same(currentOrder.token, TOKEN)) {
          throw new Error("该订单不属于当前买家，或状态/代币不允许付款。");
        }
        setMessage(`订单 #${id}：第 1/2 笔 approve，请先截图 MetaMask 弹窗，再确认。`);
        assertWallet(caller);
        const approved = await writeToken({ functionName: "approve", args: [ESCROW, currentOrder.amount] });
        // Scaffold 的 writeContractAsync 已等待成功回执；未返回哈希也必须中止。
        save("approve", id.toString(), approved, caller);
        assertWallet(caller);
        setMessage(`订单 #${id}：授权已确认，第 2/2 笔 deposit，请先截图弹窗，再确认。`);
        const paid = await writeEscrow({ functionName: "deposit", args: [id] });
        save("deposit", id.toString(), paid, caller);
        setMessage(`订单 #${id} 付款成功，等待列表更新为 Paid。`);
        return;
      }
      assertWallet(caller);
      setMessage(`订单 #${id}：请在 MetaMask 确认并等待交易成功。`);
      const hash =
        action === "confirm" || action === "dispute"
          ? await writeEscrow({ functionName: action, args: [id] })
          : await writeEscrow({ functionName: "resolve", args: [id, action === "sellerWins"] });
      save(
        action === "sellerWins" || action === "buyerWins" ? `resolve(${action === "sellerWins"})` : action,
        id.toString(),
        hash,
        caller,
      );
      setMessage(`订单 #${id} 操作成功，等待列表更新。`);
    });
  }

  return (
    <main className="mx-auto w-full max-w-screen-2xl p-4 md:p-8 space-y-6">
      <h1 className="text-3xl font-bold">订单托管</h1>
      <section className="rounded-2xl bg-base-100 p-5 space-y-2">
        <div className="break-all">当前账户：{address ?? "未连接，请使用右上角连接钱包"}</div>
        <div>
          当前角色：
          {!address ? "未连接" : roles.join("、") || (isLoading || isFetchingNewEvent ? "订单同步中" : "旁观者")}
        </div>
        <div className="break-all">仲裁人：{arbiter ?? "读取中…"}</div>
        <div className="break-all">Escrow：{ESCROW}</div>
        <div className="break-all">代币：LRS202430552535（{TOKEN}）</div>
        <div>当前账户代币余额：{balance === undefined ? "—" : formatUnits(balance, 18)} 个</div>
        {address && chainId !== CHAIN_ID && <p className="text-error">请将钱包切换到 POTOS Testnet（60600）。</p>}
        {escrow && token && !correctlyConfigured && (
          <p className="text-error">部署配置不一致，已禁用交易，请勿重新部署。</p>
        )}
      </section>

      <section className="rounded-2xl bg-base-100 p-5">
        <h2 className="text-xl font-bold mb-4">创建订单</h2>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={event => {
            event.preventDefault();
            void createOrder();
          }}
        >
          <label className="flex flex-col gap-1">
            卖家地址
            <input
              className="input input-bordered w-full"
              required
              value={seller}
              disabled={busy}
              onChange={event => setSeller(event.target.value.trim())}
            />
          </label>
          <label className="flex flex-col gap-1">
            金额（个）
            <input
              className="input input-bordered w-full"
              required
              inputMode="decimal"
              value={amount}
              disabled={busy}
              onChange={event => setAmount(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            多少分钟后到期
            <input
              className="input input-bordered w-full"
              required
              inputMode="numeric"
              value={minutes}
              disabled={busy}
              onChange={event => setMinutes(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            描述
            <input
              className="input input-bordered w-full"
              value={description}
              disabled={busy}
              onChange={event => setDescription(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary md:col-span-2" disabled={disabled}>
            创建订单
          </button>
        </form>
      </section>

      <div aria-live="polite" className="space-y-2">
        {message && (
          <p className="break-words">
            {busy ? "处理中：" : ""}
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-error whitespace-pre-wrap break-words">
            {error}
          </p>
        )}
      </div>

      <section className="rounded-2xl bg-base-100 p-5">
        <h2 className="text-xl font-bold">订单列表</h2>
        <p>
          已发现 {ids.length} / 链上共 {orderCount?.toString() ?? "—"} 笔订单。
          {isLoading || isFetchingNewEvent ? "正在分批同步历史事件，请稍候…" : "每轮区块同步后刷新状态。"}
        </p>
        {eventsError && <p className="text-error">事件同步失败：{eventsError.message}。请刷新页面重试。</p>}
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>编号</th>
                <th>参与者</th>
                <th>金额与代币</th>
                <th>到期时间</th>
                <th>描述</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {ids.map(id => (
                <OrderRow
                  key={id.toString()}
                  id={id}
                  address={address}
                  arbiter={arbiter}
                  disabled={disabled}
                  act={(orderId, action) => void act(orderId, action)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl bg-base-100 p-5">
        <h2 className="text-xl font-bold">本页成功交易记录</h2>
        <p>刷新或关闭页面会清空此列表，请及时复制到 README 和报告。其他成员的交易请分别保存。</p>
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>操作</th>
                <th>订单</th>
                <th>交易哈希（点击查看）</th>
                <th>发起账户</th>
              </tr>
            </thead>
            <tbody>
              {records.map(record => (
                <tr key={record.hash}>
                  <td>{record.operation}</td>
                  <td>{record.id}</td>
                  <td className="break-all">
                    <a
                      className="link"
                      href={`https://scan-testnet.potos.hk/tx/${record.hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {record.hash}
                    </a>
                  </td>
                  <td className="break-all">{record.caller}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
