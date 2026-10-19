import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const ARBITER = "0x343b59144d6839c577e173993e70bA126624cEa6";

const deployEscrow: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  await hre.deployments.deploy("Escrow", {
    from: deployer,
    args: [ARBITER],
    log: true,
    autoMine: true,
  });
};

export default deployEscrow;
deployEscrow.tags = ["EscrowLRS202430552535"];
