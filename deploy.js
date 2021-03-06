// initialize lumos config
const { init } = require("./init_config");
init();

const {
  serializeMultisigScript,
  multisigArgs,
} = require("@ckb-lumos/common-scripts/lib/from_info");
const { getConfig, initializeConfig } = require("@ckb-lumos/config-manager");
const {
  generateAddress,
  TransactionSkeleton,
  sealTransaction,
  parseAddress,
  minimalCellCapacity,
} = require("@ckb-lumos/helpers");
const { Indexer } = require("@ckb-lumos/indexer");
const { common } = require("@ckb-lumos/common-scripts");
const { key } = require("@ckb-lumos/hd");
const fs = require("fs");
const { RPC } = require("ckb-js-toolkit");
const { generateTypeIDScript } = require("./typeid");
const { serializeDepGroupData } = require("./dep_group");
const TransactionManager = require("@ckb-lumos/transaction-manager");
const { utils } = require("@ckb-lumos/base");

const {
  fromAddress,
  multisigAddress,
  fromPrivateKey,
} = require("./multisig_helper");

const data = fs.readFileSync("./build/anyone_can_pay");
const acpData = "0x" + data.toString("hex");

console.log("Capacity fromAddress:", fromAddress);

// indexer
const url = "http://localhost:8114";
const dataDir = "./indexer-data";
const indexer = new Indexer(url, dataDir);
indexer.startForever();

const transactionManager = new TransactionManager(indexer);
const rpc = new RPC(url);

function getDataOutputCapacity() {
  const output = {
    cell_output: {
      lock: parseAddress(multisigAddress),
      type: {
        code_hash: "0x" + "0".repeat(64),
        hash_type: "type",
        args: "0x" + "0".repeat(64),
      },
      capacity: "0x0",
    },
    data: acpData,
  };

  const min = minimalCellCapacity(output);
  return min;
}

// console.log("data capacity:", getDataOutputCapacity())

async function main() {
  let txSkeleton = TransactionSkeleton({ cellProvider: indexer });

  const capacity = getDataOutputCapacity();

  txSkeleton = await common.transfer(
    txSkeleton,
    [fromAddress],
    multisigAddress,
    capacity
  );

  const firstOutput = txSkeleton.get("outputs").get(0);
  firstOutput.data = acpData;
  const firstInput = {
    previous_output: txSkeleton.get("inputs").get(0).out_point,
    since: "0x0",
  };
  const typeIDScript = generateTypeIDScript(firstInput, "0x0");
  const typeScriptHash = utils.computeScriptHash(typeIDScript);
  firstOutput.cell_output.type = typeIDScript;
  txSkeleton = txSkeleton.update("outputs", (outputs) => {
    return outputs.set(0, firstOutput);
  });

  const feeRate = BigInt(1000);
  txSkeleton = await common.payFeeByFeeRate(txSkeleton, [fromAddress], feeRate);

  txSkeleton = common.prepareSigningEntries(txSkeleton);

  const message = txSkeleton.get("signingEntries").get(0).message;
  const content = key.signRecoverable(message, fromPrivateKey);

  const tx = sealTransaction(txSkeleton, [content]);

  // console.log("tx:", JSON.stringify(tx, null, 2))

  const txHash = await transactionManager.send_transaction(tx);

  console.log("-".repeat(10) + "acp cell info" + "-".repeat(10));
  console.log("txHash:", txHash);
  console.log("index:", "0x0");
  console.log("type id:", typeScriptHash);

  const result = JSON.stringify(
    {
      tx_hash: txHash,
      index: "0x0",
      type_id: typeScriptHash,
    },
    null,
    2
  );
  fs.writeFileSync("./deploy_result.json", result);

  console.log("result already write to file `deploy_result.json`");

  // TODO: disable dep group
  // dep group
  // await generateDepGroupTx({
  //   tx_hash: txHash,
  //   index: "0x0",
  // });

  process.exit(0);
}
main();

function getDepGroupOutputCapacity() {
  const outPoints = [
    {
      tx_hash: "0x" + "0".repeat(64),
      index: "0x0",
    },
    {
      tx_hash: "0x" + "0".repeat(64),
      index: "0x0",
    },
  ];

  const output = {
    cell_output: {
      lock: parseAddress(multisigAddress),
      type: undefined,
      capacity: "0x0",
    },
    data: serializeDepGroupData(outPoints),
  };

  const min = minimalCellCapacity(output);
  return min;
}
// console.log("dep group min capacity:", getDepGroupOutputCapacity())

async function generateDepGroupTx(outPoint) {
  let txSkeleton = TransactionSkeleton({ cellProvider: transactionManager });

  const capacity = getDepGroupOutputCapacity();

  txSkeleton = await common.transfer(
    txSkeleton,
    [fromAddress],
    multisigAddress,
    capacity
  );

  const outPoints = [outPoint, await getSecpDataOutPoint()];
  const outputData = serializeDepGroupData(outPoints);

  const firstOutput = txSkeleton.get("outputs").get(0);
  firstOutput.data = outputData;
  txSkeleton = txSkeleton.update("outputs", (outputs) => {
    return outputs.set(0, firstOutput);
  });

  const feeRate = BigInt(1000);
  txSkeleton = await common.payFeeByFeeRate(txSkeleton, [fromAddress], feeRate);

  txSkeleton = common.prepareSigningEntries(txSkeleton);

  const message = txSkeleton.get("signingEntries").get(0).message;
  const content = key.signRecoverable(message, fromPrivateKey);

  const tx = sealTransaction(txSkeleton, [content]);

  // console.log("tx:", JSON.stringify(tx, null, 2))

  const txHash = await transactionManager.send_transaction(tx);

  console.log("-".repeat(10) + "dep group info" + "-".repeat(10));
  console.log("txHash:", txHash);
  console.log("index:", "0x0");
}

// generateDepGroupTx({
//   tx_hash: "0x" + "0".repeat(64),
//   index: "0x0"
// })

async function getSecpDataOutPoint() {
  const genesisBlock = await rpc.get_block_by_number("0x0");
  const transaction = genesisBlock.transactions[0];
  return {
    tx_hash: transaction.hash,
    index: "0x3",
  };
}

// (
//   async function() {
//     console.log("secp data:", await getSecpDataOutPoint())
//   }
// )()
