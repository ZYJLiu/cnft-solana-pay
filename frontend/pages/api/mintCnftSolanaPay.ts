import { NextApiRequest, NextApiResponse } from "next"
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js"
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from "@solana/spl-account-compression"
import {
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
  MetadataArgs,
  TokenProgramVersion,
  TokenStandard,
} from "@metaplex-foundation/mpl-bubblegum"
import { createMintV1Instruction } from "@metaplex-foundation/mpl-bubblegum"
import { uris } from "../../utils/uri"

// Tree address to mint the cNFTs to
// This is the same address as the one output from script/src/index.ts
const treeAddress = new PublicKey(
  process.env.NEXT_PUBLIC_TREE_ADDRESS as string
)

// Tree creator's keypair required to sign transactions
// This is the same keypair as the one generated and used to create the tree from script/src/index.ts
const treeCreator = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(process.env.TREE_CREATOR as string))
)

async function buildTransaction(account: PublicKey, reference: PublicKey) {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed")

  const randomUri = uris[Math.floor(Math.random() * uris.length)]
  const compressedNFTMetadata: MetadataArgs = {
    name: "RGB",
    symbol: "RBG",
    uri: randomUri,
    creators: [],
    editionNonce: 0,
    uses: null,
    collection: null,
    primarySaleHappened: false,
    sellerFeeBasisPoints: 0,
    isMutable: false,
    tokenProgramVersion: TokenProgramVersion.Original,
    tokenStandard: TokenStandard.NonFungible,
  }

  const [treeAuthority] = PublicKey.findProgramAddressSync(
    [treeAddress.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  )

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
  )

  instruction.keys.push({
    pubkey: reference,
    isSigner: false,
    isWritable: false,
  })

  const latestBlockhash = await connection.getLatestBlockhash()

  const transaction = new Transaction({
    feePayer: account,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction)

  transaction.sign(treeCreator)

  return transaction
    .serialize({ requireAllSignatures: false })
    .toString("base64")
}

async function post(req: NextApiRequest, res: NextApiResponse) {
  const { account } = req.body
  const { reference } = req.query

  if (!account || !reference) {
    res.status(400).json({
      error: "Required data missing. Account or reference not provided.",
    })
    return
  }

  try {
    const transaction = await buildTransaction(
      new PublicKey(account),
      new PublicKey(reference)
    )
    res.status(200).json({
      transaction,
      message: "Please approve the transaction to mint your NFT!",
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Error processing request" })
  }
}

function get(res: NextApiResponse) {
  res.status(200).json({
    label: "CNFT",
    icon: "https://solana.com/src/img/branding/solanaLogoMark.svg",
  })
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "GET") {
    return get(res)
  } else if (req.method === "POST") {
    return await post(req, res)
  } else {
    return res.status(405).json({ error: "Method not allowed" })
  }
}
