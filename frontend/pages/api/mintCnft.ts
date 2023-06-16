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

const treeAddress = new PublicKey(
  "BzmGuCAT2XduxZihakSpMfKCDFu31Sgrxtv23YJFD2EG"
)
const treeCreator = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(process.env.PRIVATE_KEY as string))
)

type InputData = {
  account: string
}

type GetResponse = {
  label: string
  icon: string
}

export type PostResponse = {
  transaction: string
  message: string
}

export type PostError = {
  error: string
}

function get(res: NextApiResponse<GetResponse>) {
  res.status(200).json({
    label: "CNFT",
    icon: "https://solana.com/src/img/branding/solanaLogoMark.svg",
  })
}

async function post(
  req: NextApiRequest,
  res: NextApiResponse<PostResponse | PostError>
) {
  const { account } = req.body as InputData
  console.log(req.body)
  if (!account) {
    res.status(400).json({ error: "No account provided" })
    return
  }

  const { reference } = req.query
  if (!reference) {
    console.log("Returning 400: no reference")
    res.status(400).json({ error: "No reference provided" })
    return
  }

  try {
    const mintOutputData = await postImpl(
      new PublicKey(account),
      new PublicKey(reference)
    )
    res.status(200).json(mintOutputData)
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "error creating transaction" })
    return
  }
}

async function postImpl(
  account: PublicKey,
  reference: PublicKey
): Promise<PostResponse> {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed")

  // Select a random URI from uris
  const randomUri = uris[Math.floor(Math.random() * uris.length)]
  console.log("randomUri", randomUri)

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
      payer: account, // The account that will pay for the transaction
      merkleTree: treeAddress, // The address of the tree account
      treeAuthority, // The authority of the tree account, should be a PDA derived from the tree account address
      treeDelegate: treeCreator.publicKey, // The delegate of the tree account, tree creator by default, required as signer
      leafOwner: account, // The owner of the compressed NFT being minted to the tree
      leafDelegate: account, // The delegate of the compressed NFT being minted to the tree
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

  // Convert to transaction
  const latestBlockhash = await connection.getLatestBlockhash()

  // create new Transaction and add the instruction
  const transaction = new Transaction({
    feePayer: account,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction)

  transaction.sign(treeCreator)

  // Serialize the transaction and convert to base64 to return it
  const serializedTransaction = transaction.serialize({
    requireAllSignatures: false, // account is a missing signature
  })
  const base64 = serializedTransaction.toString("base64")

  const message = "Please approve the transaction to mint your NFT!"

  // Return the serialized transaction
  return {
    transaction: base64,
    message,
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GetResponse | PostResponse | PostError>
) {
  if (req.method === "GET") {
    return get(res)
  } else if (req.method === "POST") {
    return await post(req, res)
  } else {
    return res.status(405).json({ error: "Method not allowed" })
  }
}
