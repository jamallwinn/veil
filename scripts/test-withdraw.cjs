require('dotenv').config();
const { ethers } = require('ethers');
const { buildPoseidon } = require('circomlibjs');
const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');

const TEST_POOL = '0xf8aD883ad9EA9BA75BDf31b6f1d4B7eaBc266f84';

const ZEROS = [
  '20282559595580390386239320972589885322571241193217477968281590821058153745105',
  '3274439366190977746073845188500475046446520114041572123218230963853477152652',
  '21824696504143889823808000405652102073630578351459095501572688600629305197061',
  '4829882791870146971335996492782653226712763398568263169937574164058019279763',
  '19727944145920873032916231804390263655607021350360944996762502777010006047232',
  '12573616683620136186358076578923106319443727918715988430556975051719972102048',
  '20405764044244033966783614370100035550454543400854684595867636436287473374230',
  '7098593250002836498039706892886264767966219678786136596135924683362313216949',
  '10614461445763314670098655164277864019426687644326705180250511057194315579246',
  '16126229332654394463116787064431180585243709535536964509568907083276419220720',
  '13260706536739717135161925486362785721164009104353869003025642793429652376723',
  '21724731140591664080916319881133883044719500025782445336921685983880721634670',
  '12485256800448034846922129861121743630219421178381117121924516717857326507717',
  '15356968726074633924886273751460462503048149542957754123020595671249255383445',
  '17589149050941078564770579918837254372671706970705658580717390011385999912276',
  '6906365566047511210450524710679464510839320728492097571769860075033593263841',
  '11772834041673690955723535883322245291285761724475948631352422726028620232375',
  '2441162013776382406394170084280306821308201105576789065210555600748327343742',
  '8787895828041719154842134501079118746313815157330466076596732642977139060888',
  '4655049255717070280843259395955534038865636352540410624644680554571210614192',
];

async function main() {
  console.log('VEIL PRIVATE WITHDRAWAL - PRODUCTION TEST');
  console.log('=========================================\n');

  const provider = new ethers.JsonRpcProvider('https://rpc.xrplevm.org');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const poseidon = await buildPoseidon();

  // Load deposit note
  const notePath = path.join(__dirname, '..', 'test-deposit-note.json');
  const note = JSON.parse(fs.readFileSync(notePath, 'utf8'));
  const nullifier = BigInt(note.nullifier);
  const secret = BigInt(note.secret);

  console.log('[1/5] Deposit note loaded');

  // Compute nullifier hash
  const nullifierHash = poseidon.F.toObject(poseidon([nullifier]));
  console.log('[2/5] Nullifier hash computed');

  // Build Merkle path from saved note (handles any leaf index)
  const pathElements = note.pathElements || ZEROS;
  const pathIndices = note.pathIndices || Array(20).fill(0);

  // Recipient
  const recipient = wallet.address;
  console.log('     Recipient:', recipient);

  // Circuit inputs
  const inputs = {
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements,
    pathIndices,
    root: note.merkleRoot,
    nullifierHash: nullifierHash.toString(),
    recipient: BigInt(recipient).toString(),
    relayer: '0',
    fee: '0',
    refund: '0',
  };

  console.log('[3/5] Generating ZK proof...');
  const start = Date.now();

  const wasmPath = path.join(__dirname, '..', 'build/withdraw_js/withdraw.wasm');
  const zkeyPath = path.join(__dirname, '..', 'build/withdraw_final.zkey');

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, wasmPath, zkeyPath);

  console.log('     Done in ' + ((Date.now() - start) / 1000).toFixed(1) + 's');

  // Format for Solidity (note b array swap)
  const solidityProof = {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
    c: [proof.pi_c[0], proof.pi_c[1]],
  };

  console.log('[4/5] Submitting withdrawal...');

  const poolABI = [
    'function withdraw(tuple(uint256[2] a, uint256[2][2] b, uint256[2] c) _proof, uint256 _root, uint256 _nullifierHash, address _recipient, address _relayer, uint256 _fee, uint256 _refund) external',
  ];

  const pool = new ethers.Contract(TEST_POOL, poolABI, wallet);

  const tx = await pool.withdraw(
    solidityProof,
    note.merkleRoot,
    nullifierHash.toString(),
    recipient,
    '0x0000000000000000000000000000000000000000',
    0,
    0,
    { gasPrice: 275000000000n, gasLimit: 500000 }
  );

  console.log('     TX: ' + tx.hash);
  const receipt = await tx.wait();

  console.log('[5/5] Confirmed in block ' + receipt.blockNumber);
  console.log('     Gas used: ' + receipt.gasUsed.toString());

  const walletBal = await provider.getBalance(wallet.address);
  const poolBal = await provider.getBalance(TEST_POOL);

  console.log('\n=========================================');
  console.log('PRIVATE WITHDRAWAL COMPLETE');
  console.log('=========================================');
  console.log('Wallet: ' + ethers.formatEther(walletBal) + ' XRP');
  console.log('Pool:   ' + ethers.formatEther(poolBal) + ' XRP');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
