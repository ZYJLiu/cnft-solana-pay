import { Button, Flex, VStack } from "@chakra-ui/react"
import {
  createQR,
  encodeURL,
  findReference,
  FindReferenceError,
  TransactionRequestURLFields,
  ValidateTransferError,
} from "@solana/pay"
import { clusterApiUrl, Connection, Keypair } from "@solana/web3.js"
import { useEffect, useRef, useState } from "react"
import Confirmed from "./Confirmed"

interface Props {
  onClose: () => void
}

const QrModal = ({ onClose }: Props) => {
  const connection = new Connection(clusterApiUrl("devnet"))
  const qrRef = useRef<HTMLDivElement>(null)
  const [reference] = useState(Keypair.generate().publicKey)
  const [confirmed, setConfirmed] = useState(false)
  const [size, setSize] = useState(() =>
    typeof window === "undefined" ? 100 : Math.min(window.outerWidth - 10, 512)
  )

  useEffect(() => {
    const listener = () => setSize(Math.min(window.outerWidth - 10, 512))
    window.addEventListener("resize", listener)
    return () => window.removeEventListener("resize", listener)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    params.append("reference", reference.toString())

    const apiUrl = `${window.location.protocol}//${
      window.location.host
    }/api/mintCnftSolanaPay?${params.toString()}`
    const urlParams: TransactionRequestURLFields = {
      link: new URL(apiUrl),
      label: "Label",
      message: "Message",
    }
    const solanaUrl = encodeURL(urlParams)
    console.log(solanaUrl.href)
    const qr = createQR(solanaUrl, size, "white")
    if (qrRef.current) {
      qrRef.current.innerHTML = ""
      qr.append(qrRef.current)
    }
  }, [size, reference])

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const signatureInfo = await findReference(connection, reference, {
          finality: "confirmed",
        })
        if (signatureInfo) {
          console.log("Transaction confirmed", signatureInfo)
          clearInterval(interval)
          setConfirmed(true)
        }
      } catch (e) {
        if (e instanceof FindReferenceError) return
        if (e instanceof ValidateTransferError) {
          console.error("Transaction is invalid", e)
          return
        }
        console.error("Unknown error", e)
      }
    }, 500)
    return () => {
      clearInterval(interval)
      setConfirmed(false)
    }
  }, [reference.toString()])

  return (
    <VStack
      position="fixed"
      top="50%"
      left="50%"
      transform="translate(-50%, -50%)"
      backgroundColor="white"
      padding="10px"
      rounded="2xl"
    >
      {confirmed ? (
        <div style={{ width: size }}>
          <Confirmed />
        </div>
      ) : (
        <Flex ref={qrRef} />
      )}
      <Button
        color="gray"
        onClick={() => {
          setConfirmed(false)
          onClose()
        }}
      >
        Close
      </Button>
    </VStack>
  )
}

export default QrModal
