// Example of backend signing a transaction
import { getRandomUri } from "@/utils/uri";
import {
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
  MetadataArgs,
  TokenProgramVersion,
  TokenStandard,
  createMintV1Instruction,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import { NextApiRequest, NextApiResponse } from "next";
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from "@solana/spl-account-compression";

// Tree address to mint the cNFTs to
// This is the same address as the one output from script/src/index.ts
const treeAddress = new PublicKey(
  process.env.NEXT_PUBLIC_TREE_ADDRESS as string
);

// Tree creator's keypair required to sign transactions
// This is the same keypair as the one generated and used to create the tree from script/src/index.ts
const treeCreator = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(process.env.TREE_CREATOR as string))
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { account } = req.body;

  if (!account) {
    res.status(400).json({ error: "No account provided" });
    return;
  }

  try {
    const transaction = await buildTransaction(new PublicKey(account));
    res.status(200).json({ transaction });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error processing request" });
  }
}

async function buildTransaction(account: PublicKey) {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  const compressedNFTMetadata: MetadataArgs = {
    name: "OPOS",
    symbol: "OPOS",
    uri: getRandomUri(),
    creators: [],
    editionNonce: 0,
    uses: null,
    collection: null,
    primarySaleHappened: false,
    sellerFeeBasisPoints: 0,
    isMutable: false,
    tokenProgramVersion: TokenProgramVersion.Original,
    tokenStandard: TokenStandard.NonFungible,
  };

  const [treeAuthority] = PublicKey.findProgramAddressSync(
    [treeAddress.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );

  const instruction = createMintV1Instruction(
    {
      payer: account,
      merkleTree: treeAddress,
      treeAuthority,
      treeDelegate: treeCreator.publicKey,
      leafOwner: account,
      leafDelegate: account,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      logWrapper: SPL_NOOP_PROGRAM_ID,
    },
    {
      message: Object.assign(compressedNFTMetadata),
    }
  );

  const latestBlockhash = await connection.getLatestBlockhash();

  const transaction = new Transaction({
    feePayer: account,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction);

  transaction.sign(treeCreator);

  return transaction
    .serialize({ requireAllSignatures: false })
    .toString("base64");
}
