import { uris } from "@/utils/uri"
import {
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
  MetadataArgs,
  TokenProgramVersion,
  TokenStandard,
  createMintV1Instruction,
} from "@metaplex-foundation/mpl-bubblegum"
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js"
import { NextApiRequest, NextApiResponse } from "next"
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from "@solana/spl-account-compression"

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

type InputData = {
  account: string
}

type PostError = {
  error: string
}

type PostResponse = {
  transaction: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PostResponse | PostError>
) {
  const { account } = req.body as InputData
  const accountPubkey = new PublicKey(account)

  if (!account) {
    res.status(400).json({ error: "No account provided" })
    return
  }

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed")

  // Select a random URI from uris
  const randomUri = uris[Math.floor(Math.random() * uris.length)]

  // Compressed NFT Metadata
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

  // Derive the tree authority PDA ('TreeConfig' account for the tree account)
  const [treeAuthority] = PublicKey.findProgramAddressSync(
    [treeAddress.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  )

  // Create the instruction to "mint" the compressed NFT to the tree
  const instruction = createMintV1Instruction(
    {
      payer: accountPubkey, // The account that will pay for the transaction
      merkleTree: treeAddress, // The address of the tree account
      treeAuthority, // The authority of the tree account, should be a PDA derived from the tree account address
      treeDelegate: treeCreator.publicKey, // The delegate of the tree account, tree creator by default, required as signer
      leafOwner: accountPubkey, // The owner of the compressed NFT being minted to the tree
      leafDelegate: accountPubkey, // The delegate of the compressed NFT being minted to the tree
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      logWrapper: SPL_NOOP_PROGRAM_ID,
    },
    {
      message: Object.assign(compressedNFTMetadata),
    }
  )

  // Get the latest blockhash
  const latestBlockhash = await connection.getLatestBlockhash()

  // Create new Transaction and add the instruction
  const transaction = new Transaction({
    feePayer: accountPubkey,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction)

  // Sign the transaction with the tree creator's keypair (default tree delegate, required as signer)
  transaction.sign(treeCreator)

  // Serialize the transaction and convert to base64 to return it
  const serializedTransaction = transaction.serialize({
    requireAllSignatures: false,
  })
  const base64 = serializedTransaction.toString("base64")

  try {
    // Just return the received publicKey
    res.status(200).json({ transaction: base64 })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Error processing request" })
    return
  }
}
