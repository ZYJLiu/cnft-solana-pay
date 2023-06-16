import { Connection, clusterApiUrl } from "@solana/web3.js"
import { getOrCreateKeypair, airdropSolIfNeeded, createTree } from "./utils"
import { ValidDepthSizePair } from "@solana/spl-account-compression"

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed")
  const wallet = await getOrCreateKeypair("Wallet_1")
  airdropSolIfNeeded(wallet.publicKey)

  const maxDepthSizePair: ValidDepthSizePair = {
    maxDepth: 3,
    maxBufferSize: 8,
  }

  const canopyDepth = 0

  const treeAddress = await createTree(
    connection,
    wallet,
    maxDepthSizePair,
    canopyDepth
  )
}

main()
