import { Button } from "@chakra-ui/react"
import { Transaction } from "@solana/web3.js"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { useEffect, useState } from "react"

export default function MintCnft() {
  const { publicKey, sendTransaction } = useWallet()
  const { connection } = useConnection()

  const [location, setLocation] = useState<Location | null>(null)

  useEffect(() => {
    if (typeof window !== "undefined") {
      setLocation(window.location)
    }
  }, [])

  const onClick = async () => {
    if (!publicKey || !location) return

    try {
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

      if (!response.ok) throw new Error("Failed to fetch the transaction data")

      const data = await response.json()

      const deserializedTransaction = Transaction.from(
        Buffer.from(data.transaction, "base64")
      )

      await sendTransaction(deserializedTransaction, connection)
    } catch (error) {
      console.log(error)
    }
  }

  return publicKey && <Button onClick={onClick}>Mint CNFT</Button>
}
