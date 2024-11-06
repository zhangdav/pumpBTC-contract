const { run } = require("hardhat");
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const lockAssetAddress = "Your PumpBTC address"; // PumpBTC address
  const mintAssetAddress = "Your OFT address"; // PumpBTC.bera address

  // deploy lockMint contract
  const LockMint = await ethers.getContractFactory("LockMint");
  const lockMint = await LockMint.deploy(lockAssetAddress, mintAssetAddress);

  console.log("LockMint deployed to:", lockMint.target);

  await lockMint.waitForDeployment();
  const lockMintAddr = lockMint.target

  try {
    await run("verify:verify", {
      address: lockMintAddr,
      constructorArguments: [],
    });
    console.log("Contract verified successfully!");
  } catch (error) {
    console.error("Verification failed:", error);
  }

}  

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

