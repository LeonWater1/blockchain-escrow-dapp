import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const AMOUNT = ethers.parseUnits("30", 18);
const INITIAL_BALANCE = ethers.parseUnits("100", 18);

async function deployFixture() {
  const [deployer, buyer, seller, arbiter, stranger] = await ethers.getSigners();

  const token = await ethers.deployContract("LRSToken");
  await token.waitForDeployment();
  await (await token.mint(buyer.address, INITIAL_BALANCE)).wait();

  const escrow = await ethers.deployContract("Escrow", [arbiter.address]);
  await escrow.waitForDeployment();

  const deadline = (await time.latest()) + 3600;

  return {
    token,
    escrow,
    deployer,
    buyer,
    seller,
    arbiter,
    stranger,
    deadline,
  };
}

// 创建订单，状态为 Created。
async function createdOrderFixture() {
  const context = await deployFixture();
  const { token, escrow, buyer, seller, deadline } = context;

  await (
    await escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书")
  ).wait();

  return context;
}

// 买家授权并付款，状态为 Paid。
async function paidOrderFixture() {
  const context = await createdOrderFixture();
  const { token, escrow, buyer } = context;

  await (await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT)).wait();

  await (await escrow.connect(buyer).deposit(0)).wait();

  return context;
}

// 买家发起争议，状态为 Disputed。
async function disputedOrderFixture() {
  const context = await paidOrderFixture();
  const { escrow, buyer } = context;

  await (await escrow.connect(buyer).dispute(0)).wait();

  return context;
}

describe("Escrow", function () {
  it("createOrder 记录订单并发出事件", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书"),
    )
      .to.emit(escrow, "OrderCreated")
      .withArgs(0, buyer.address, seller.address, await token.getAddress(), AMOUNT, deadline);

    const order = await escrow.getOrder(0);

    expect(order.buyer).to.equal(buyer.address);
    expect(order.seller).to.equal(seller.address);
    expect(order.token).to.equal(await token.getAddress());
    expect(order.amount).to.equal(AMOUNT);
    expect(order.deadline).to.equal(deadline);
    expect(order.description).to.equal("一本书");
    expect(order.status).to.equal(0n); // Created
    expect(await escrow.orderCount()).to.equal(1n);
  });

  it("未 approve 时 deposit 失败", async function () {
    const { token, escrow, buyer } = await loadFixture(createdOrderFixture);

    await expect(escrow.connect(buyer).deposit(0)).to.be.revertedWith("LRSToken: insufficient allowance");

    // 转账失败后，订单状态和余额都应回滚。
    expect((await escrow.getOrder(0)).status).to.equal(0n);
    expect(await token.balanceOf(buyer.address)).to.equal(INITIAL_BALANCE);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
  });

  it("approve 后 deposit 成功，代币进入 Escrow，状态变为 Paid", async function () {
    const { token, escrow, buyer } = await loadFixture(createdOrderFixture);
    const escrowAddress = await escrow.getAddress();

    await (await token.connect(buyer).approve(escrowAddress, AMOUNT)).wait();

    await expect(escrow.connect(buyer).deposit(0)).to.emit(escrow, "OrderPaid").withArgs(0);

    expect(await token.balanceOf(escrowAddress)).to.equal(AMOUNT);
    expect(await token.balanceOf(buyer.address)).to.equal(INITIAL_BALANCE - AMOUNT);
    expect((await escrow.getOrder(0)).status).to.equal(1n); // Paid
    expect(await token.allowance(buyer.address, escrowAddress)).to.equal(0n);
  });

  it("非买家调用 confirm 失败", async function () {
    const { token, escrow, seller } = await loadFixture(paidOrderFixture);

    await expect(escrow.connect(seller).confirm(0)).to.be.revertedWith("Escrow: caller is not the buyer");

    expect((await escrow.getOrder(0)).status).to.equal(1n);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);
    expect(await token.balanceOf(seller.address)).to.equal(0n);
  });

  it("confirm 后卖家收到代币，状态变为 Completed", async function () {
    const { token, escrow, buyer, seller } = await loadFixture(paidOrderFixture);

    await expect(escrow.connect(buyer).confirm(0)).to.emit(escrow, "OrderCompleted").withArgs(0);

    expect(await token.balanceOf(seller.address)).to.equal(AMOUNT);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    expect(await token.balanceOf(buyer.address)).to.equal(INITIAL_BALANCE - AMOUNT);
    expect((await escrow.getOrder(0)).status).to.equal(2n); // Completed

    // 已完成的订单不能重复确认。
    await expect(escrow.connect(buyer).confirm(0)).to.be.revertedWith("Escrow: wrong status");
  });

  it("deadline 之前 refund 失败，deadline 之后 refund 成功并退回买家", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(paidOrderFixture);

    await expect(escrow.connect(buyer).refund(0)).to.be.revertedWith("Escrow: deadline has not passed");

    expect((await escrow.getOrder(0)).status).to.equal(1n);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);

    // 合约要求当前时间严格大于 deadline。
    await time.increaseTo(deadline + 1);

    await expect(escrow.connect(buyer).refund(0)).to.emit(escrow, "OrderRefunded").withArgs(0);

    expect(await token.balanceOf(buyer.address)).to.equal(INITIAL_BALANCE);
    expect(await token.balanceOf(seller.address)).to.equal(0n);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    expect((await escrow.getOrder(0)).status).to.equal(3n); // Refunded
  });

  it("非仲裁人调用 resolve 失败", async function () {
    const { token, escrow, stranger } = await loadFixture(disputedOrderFixture);

    await expect(escrow.connect(stranger).resolve(0, false)).to.be.revertedWith("Escrow: caller is not the arbiter");

    expect((await escrow.getOrder(0)).status).to.equal(4n); // Disputed
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);
  });

  it("dispute 后仲裁人 resolve(false) 退款给买家，状态变为 Refunded", async function () {
    const { token, escrow, buyer, seller, arbiter } = await loadFixture(paidOrderFixture);

    await expect(escrow.connect(buyer).dispute(0)).to.emit(escrow, "OrderDisputed").withArgs(0, buyer.address);

    expect((await escrow.getOrder(0)).status).to.equal(4n); // Disputed

    await expect(escrow.connect(arbiter).resolve(0, false)).to.emit(escrow, "OrderResolved").withArgs(0, false);

    expect(await token.balanceOf(buyer.address)).to.equal(INITIAL_BALANCE);
    expect(await token.balanceOf(seller.address)).to.equal(0n);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    expect((await escrow.getOrder(0)).status).to.equal(3n); // Refunded

    // 已退款的订单不能重复仲裁。
    await expect(escrow.connect(arbiter).resolve(0, false)).to.be.revertedWith("Escrow: wrong status");
  });
});
