import { Wallet } from "ethers";

const wallet = Wallet.createRandom();

console.log("\n========================================================");
console.log("🌟 ALGOTRADE WALLET GENERATION SUCCESSFUL 🌟");
console.log("========================================================");
console.log("📍 PUBLIC ADDRESS (Deposit Polygon USDC/MATIC here):");
console.log("   " + wallet.address);
console.log("--------------------------------------------------------");
console.log("\n🔑 PRIVATE KEY (KEEP THIS SECRET!):");
console.log("   " + wallet.privateKey);
console.log("\n========================================================\n");
console.log("👉 NEXT STEPS FOR POLYMARKET ONBOARDING:");
console.log("1. Add this PRIVATE KEY to your .env file as POLYMARKET_PRIVATE_KEY");
console.log("2. Open MetaMask -> Click Account Dropdown -> 'Add account or hardware wallet' -> 'Import Account' -> Paste the Private Key.");
console.log("3. Go to polymarket.com -> Log in -> Connect the newly imported MetaMask account.");
console.log("   *Note: If MetaMask shows a QR code and gets stuck, press F5 to refresh the page and try connecting again.*");
console.log("4. Go to polymarket.com/settings?tab=builder and click '+ Create New'");
console.log("5. Important: Because this is a new wallet, Polymarket will show an 'Enable Trading' popup with 3 steps:");
console.log("   - Deploy Proxy Wallet (Click Deploy & Confirm in MetaMask)");
console.log("   - Enable Trading (Click Sign & Confirm in MetaMask)");
console.log("   - Approve Tokens (Click Sign & Confirm in MetaMask)");
console.log("6. Save the generated API Key, Secret, and Passphrase to your .env file.");
console.log("========================================================\n");
