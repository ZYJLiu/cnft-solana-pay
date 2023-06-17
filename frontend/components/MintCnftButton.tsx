import { useEffect, useState } from "react"
import { Button } from "@chakra-ui/react"
import { Transaction } from "@solana/web3.js"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"

export default function MintCnft() {
  const { publicKey, sendTransaction } = useWallet()
  const { connection } = useConnection()

  const [location, setLocation] = useState<Location | null>(null)

  useEffect(() => {
    if (typeof window !== "undefined") {
      setLocation(window.location)
    }
  }, [])

  const buildTransaction = async () => {
    if (!publicKey || !location) {
      throw new Error("publicKey or location is not defined")
    }

    const apiUrl = `${location.protocol}//${location.host}/api/mintCnftClient`

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account: publicKey.toBase58(),
      }),
    })

    if (!response.ok) throw new Error("Failed to build transaction")

    const data = await response.json()

    return Transaction.from(Buffer.from(data.transaction, "base64"))
  }

  const onClick = async () => {
    try {
      const transaction = await buildTransaction()

      await sendTransaction(transaction, connection)
    } catch (error) {
      console.log(error)
    }
  }

  return publicKey && <Button onClick={onClick}>Mint Compressed NFT</Button>
}
