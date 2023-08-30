import {
  AccountMeta,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";

import * as fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import {
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ConcurrentMerkleTreeAccount,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  ValidDepthSizePair,
  createAllocTreeIx,
  deserializeChangeLogEventV1,
} from "@solana/spl-account-compression";
import {
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
  MetadataArgs,
  TokenProgramVersion,
  TokenStandard,
  createBurnInstruction,
  createCreateTreeInstruction,
  createMintV1Instruction,
  createMintToCollectionV1Instruction,
  createTransferInstruction,
  getLeafAssetId,
} from "@metaplex-foundation/mpl-bubblegum";
import { getRandomUri } from "./uri";
import base58 from "bs58";
import BN from "bn.js";
import {
  CreateCompressedNftOutput,
  Metaplex,
  keypairIdentity,
} from "@metaplex-foundation/js";
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";

dotenv.config();

// This function will return an existing keypair if it's present in the environment variables, or generate a new one if not
export async function getOrCreateKeypair(walletName: string): Promise<Keypair> {
  // Check if secretKey for `walletName` exist in .env file
  const envWalletKey = process.env[walletName];

  let keypair: Keypair;

  // If no secretKey exist in the .env file for `walletName`
  if (!envWalletKey) {
    console.log(`Writing ${walletName} keypair to .env file...`);

    // Generate a new keypair
    keypair = Keypair.generate();

    // Save to .env file
    fs.appendFileSync(
      ".env",
      `\n${walletName}=${JSON.stringify(Array.from(keypair.secretKey))}`
    );
  }
  // If secretKey already exists in the .env file
  else {
    // Create a Keypair from the secretKey
    const secretKey = new Uint8Array(JSON.parse(envWalletKey));
    keypair = Keypair.fromSecretKey(secretKey);
  }

  // Log public key and return the keypair
  console.log(`${walletName} PublicKey: ${keypair.publicKey.toBase58()}`);
  return keypair;
}

export async function airdropSolIfNeeded(publicKey: PublicKey) {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  const balance = await connection.getBalance(publicKey);
  console.log("Current balance is", balance / LAMPORTS_PER_SOL);

  if (balance < 1 * LAMPORTS_PER_SOL) {
    try {
      console.log("Airdropping 2 SOL...");

      const txSignature = await connection.requestAirdrop(
        publicKey,
        2 * LAMPORTS_PER_SOL
      );

      const latestBlockHash = await connection.getLatestBlockhash();

      await connection.confirmTransaction(
        {
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: txSignature,
        },
        "confirmed"
      );

      const newBalance = await connection.getBalance(publicKey);
      console.log("New balance is", newBalance / LAMPORTS_PER_SOL);
    } catch (e) {
      console.log(
        "Airdrop Unsuccessful, likely rate-limited. Try again later."
      );
    }
  }
}

export async function transferSolIfNeeded(sender: Keypair, receiver: Keypair) {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  const balance = await connection.getBalance(receiver.publicKey);
  console.log("Current balance is", balance / LAMPORTS_PER_SOL);

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    try {
      let ix = SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: receiver.publicKey,
        lamports: LAMPORTS_PER_SOL,
      });

      await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
        sender,
      ]);

      const newBalance = await connection.getBalance(receiver.publicKey);
      console.log("New balance is", newBalance / LAMPORTS_PER_SOL);
    } catch (e) {
      console.log("SOL Transfer Unsuccessful");
    }
  }
}

export async function heliusApi(method, params) {
  const response = await fetch(process.env.RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "my-id",
      method,
      params,
    }),
  });
  const { result } = await response.json();
  return result;
}

export function createCompressedNFTMetadata(creatorPublicKey: PublicKey) {
  // Compressed NFT Metadata
  const compressedNFTMetadata: MetadataArgs = {
    name: "CNFT",
    symbol: "CNFT",
    uri: getRandomUri(),
    creators: [{ address: creatorPublicKey, verified: false, share: 100 }],
    editionNonce: 0,
    uses: null,
    collection: null,
    primarySaleHappened: false,
    sellerFeeBasisPoints: 0,
    isMutable: false,
    tokenProgramVersion: TokenProgramVersion.Original,
    tokenStandard: TokenStandard.NonFungible,
  };

  return compressedNFTMetadata;
}

export async function extractAssetId(
  connection: Connection,
  txSignature: string,
  treeAddress: PublicKey
) {
  // Get the transaction info using the tx signature
  const txInfo = await connection.getTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
  });

  // Function to check the program Id of an instruction
  const isProgramId = (instruction, programId) =>
    txInfo?.transaction.message.staticAccountKeys[
      instruction.programIdIndex
    ].toBase58() === programId;

  // Find the index of the bubblegum instruction
  const relevantIndex =
    txInfo!.transaction.message.compiledInstructions.findIndex((instruction) =>
      isProgramId(instruction, BUBBLEGUM_PROGRAM_ID.toBase58())
    );

  // If there's no matching Bubblegum instruction, exit
  if (relevantIndex < 0) {
    return;
  }

  // Get the inner instructions related to the bubblegum instruction
  const relevantInnerInstructions =
    txInfo!.meta?.innerInstructions?.[relevantIndex].instructions;

  // Filter out the instructions that aren't no-ops
  const relevantInnerIxs = relevantInnerInstructions.filter((instruction) =>
    isProgramId(instruction, SPL_NOOP_PROGRAM_ID.toBase58())
  );

  // Locate the asset index by attempting to locate and parse the correct `relevantInnerIx`
  let assetIndex;
  // Note: the `assetIndex` is expected to be at position `1`, and we normally expect only 2 `relevantInnerIx`
  for (let i = relevantInnerIxs.length - 1; i >= 0; i--) {
    try {
      // Try to decode and deserialize the instruction
      const changeLogEvent = deserializeChangeLogEventV1(
        Buffer.from(base58.decode(relevantInnerIxs[i]?.data!))
      );

      // extract a successful changelog index
      assetIndex = changeLogEvent?.index;

      // If we got a valid index, no need to continue the loop
      if (assetIndex !== undefined) {
        break;
      }
    } catch (__) {}
  }

  const assetId = await getLeafAssetId(treeAddress, new BN(assetIndex));

  console.log("Asset ID:", assetId.toBase58());

  return assetId;
}

export async function createTree(
  connection: Connection,
  payer: Keypair,
  maxDepthSizePair: ValidDepthSizePair,
  canopyDepth: number
) {
  const treeKeypair = Keypair.generate();

  const [treeAuthority, _bump] = PublicKey.findProgramAddressSync(
    [treeKeypair.publicKey.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );

  const allocTreeIx = await createAllocTreeIx(
    connection,
    treeKeypair.publicKey,
    payer.publicKey,
    maxDepthSizePair,
    canopyDepth
  );

  const createTreeIx = createCreateTreeInstruction(
    {
      treeAuthority,
      merkleTree: treeKeypair.publicKey,
      payer: payer.publicKey,
      treeCreator: payer.publicKey,
      logWrapper: SPL_NOOP_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    },
    {
      maxBufferSize: maxDepthSizePair.maxBufferSize,
      maxDepth: maxDepthSizePair.maxDepth,
      public: true,
    },
    BUBBLEGUM_PROGRAM_ID
  );

  try {
    const tx = new Transaction().add(allocTreeIx, createTreeIx);
    tx.feePayer = payer.publicKey;

    const txSignature = await sendAndConfirmTransaction(
      connection,
      tx,
      [treeKeypair, payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );

    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);

    console.log("Tree Address:", treeKeypair.publicKey.toBase58());

    return treeKeypair.publicKey;
  } catch (err: any) {
    console.error("\nFailed to create merkle tree:", err);
    throw err;
  }
}

export async function mintCompressedNFT(
  connection: Connection,
  payer: Keypair,
  treeAddress: PublicKey
) {
  // Compressed NFT Metadata
  const compressedNFTMetadata = createCompressedNFTMetadata(payer.publicKey);

  // Derive the tree authority PDA ('TreeConfig' account for the tree account)
  const [treeAuthority] = PublicKey.findProgramAddressSync(
    [treeAddress.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );

  // Create the instruction to "mint" the compressed NFT to the tree
  const mintIx = createMintV1Instruction(
    {
      payer: payer.publicKey, // The account that will pay for the transaction
      merkleTree: treeAddress, // The address of the tree account
      treeAuthority, // The authority of the tree account, should be a PDA derived from the tree account address
      treeDelegate: payer.publicKey, // The delegate of the tree account, should be the same as the tree creator by default
      leafOwner: payer.publicKey, // The owner of the compressed NFT being minted to the tree
      leafDelegate: payer.publicKey, // The delegate of the compressed NFT being minted to the tree
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      logWrapper: SPL_NOOP_PROGRAM_ID,
    },
    {
      message: Object.assign(compressedNFTMetadata),
    }
  );

  try {
    // Create new transaction and add the instruction
    const tx = new Transaction().add(mintIx);

    // Set the fee payer for the transaction
    tx.feePayer = payer.publicKey;

    // Send the transaction
    const txSignature = await sendAndConfirmTransaction(
      connection,
      tx,
      [payer],
      { commitment: "confirmed", skipPreflight: true }
    );

    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);

    const assetId = await extractAssetId(connection, txSignature, treeAddress);
    return assetId;
  } catch (err) {
    console.error("\nFailed to mint compressed NFT:", err);
    throw err;
  }
}

export async function transferCompressedNFT(
  connection: Connection,
  assetId: PublicKey,
  sender: Keypair,
  receiver: Keypair
) {
  try {
    const [assetData, assetProofData] = await Promise.all([
      heliusApi("getAsset", { id: assetId.toBase58() }),
      heliusApi("getAssetProof", { id: assetId.toBase58() }),
    ]);

    const { compression, ownership } = assetData;
    const { proof, root } = assetProofData;

    const treePublicKey = new PublicKey(compression.tree);
    const ownerPublicKey = new PublicKey(ownership.owner);
    const delegatePublicKey = ownership.delegate
      ? new PublicKey(ownership.delegate)
      : ownerPublicKey;

    const treeAccount = await ConcurrentMerkleTreeAccount.fromAccountAddress(
      connection,
      treePublicKey
    );
    const treeAuthority = treeAccount.getAuthority();
    const canopyDepth = treeAccount.getCanopyDepth() || 0;

    const proofPath: AccountMeta[] = proof
      .map((node: string) => ({
        pubkey: new PublicKey(node),
        isSigner: false,
        isWritable: false,
      }))
      .slice(0, proof.length - canopyDepth);

    const newLeafOwner = receiver.publicKey;

    const transferIx = createTransferInstruction(
      {
        merkleTree: treePublicKey,
        treeAuthority,
        leafOwner: ownerPublicKey,
        leafDelegate: delegatePublicKey,
        newLeafOwner,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        anchorRemainingAccounts: proofPath,
      },
      {
        root: [...new PublicKey(root.trim()).toBytes()],
        dataHash: [...new PublicKey(compression.data_hash.trim()).toBytes()],
        creatorHash: [
          ...new PublicKey(compression.creator_hash.trim()).toBytes(),
        ],
        nonce: compression.leaf_id,
        index: compression.leaf_id,
      },
      BUBBLEGUM_PROGRAM_ID
    );

    const tx = new Transaction().add(transferIx);
    tx.feePayer = sender.publicKey;
    const txSignature = await sendAndConfirmTransaction(
      connection,
      tx,
      [sender],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);
  } catch (err: any) {
    console.error("\nFailed to transfer nft:", err);
    throw err;
  }
}

export async function burnCompressedNFT(
  connection: Connection,
  assetId: PublicKey,
  payer: Keypair
) {
  try {
    const [assetData, assetProofData] = await Promise.all([
      heliusApi("getAsset", { id: assetId.toBase58() }),
      heliusApi("getAssetProof", { id: assetId.toBase58() }),
    ]);

    const { compression, ownership } = assetData;
    const { proof, root } = assetProofData;

    const treePublicKey = new PublicKey(compression.tree);
    const ownerPublicKey = new PublicKey(ownership.owner);
    const delegatePublicKey = ownership.delegate
      ? new PublicKey(ownership.delegate)
      : ownerPublicKey;

    const treeAccount = await ConcurrentMerkleTreeAccount.fromAccountAddress(
      connection,
      treePublicKey
    );
    const treeAuthority = treeAccount.getAuthority();
    const canopyDepth = treeAccount.getCanopyDepth() || 0;

    const proofPath: AccountMeta[] = proof
      .map((node: string) => ({
        pubkey: new PublicKey(node),
        isSigner: false,
        isWritable: false,
      }))
      .slice(0, proof.length - canopyDepth);

    const burnIx = createBurnInstruction(
      {
        treeAuthority,
        leafOwner: ownerPublicKey,
        leafDelegate: delegatePublicKey,
        merkleTree: treePublicKey,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        anchorRemainingAccounts: proofPath,
      },
      {
        root: [...new PublicKey(root.trim()).toBytes()],
        dataHash: [...new PublicKey(compression.data_hash.trim()).toBytes()],
        creatorHash: [
          ...new PublicKey(compression.creator_hash.trim()).toBytes(),
        ],
        nonce: compression.leaf_id,
        index: compression.leaf_id,
      },
      BUBBLEGUM_PROGRAM_ID
    );

    const tx = new Transaction().add(burnIx);
    tx.feePayer = payer.publicKey;
    const txSignature = await sendAndConfirmTransaction(
      connection,
      tx,
      [payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);
  } catch (err: any) {
    console.error("\nFailed to burn NFT:", err);
    throw err;
  }
}

export async function createCollectionNFT(
  connection: Connection,
  payer: Keypair
) {
  // Create Metaplex instance using payer as identity
  const metaplex = new Metaplex(connection).use(keypairIdentity(payer));

  // Create a regular collection NFT using Metaplex
  const collectionNft = await metaplex.nfts().create({
    uri: getRandomUri(),
    name: "Collection NFT",
    sellerFeeBasisPoints: 0,
    updateAuthority: payer,
    mintAuthority: payer,
    tokenStandard: 0,
    symbol: "Collection",
    isMutable: true,
    isCollection: true,
  });

  return collectionNft;
}

export async function mintCompressedNFTtoCollection(
  connection: Connection,
  payer: Keypair,
  treeAddress: PublicKey,
  collectionNft: CreateCompressedNftOutput, // Not compressed nft, just type from metaplex
  amount: number
) {
  // Define the mint address, metadata address, and master edition address of the "collection" NFT
  const collectionDetails = {
    mint: new PublicKey(collectionNft.mintAddress),
    metadata: new PublicKey(collectionNft.metadataAddress),
    masterEditionAccount: new PublicKey(collectionNft.masterEditionAddress),
  };

  // Derive the tree authority PDA ('TreeConfig' account for the tree account)
  const [treeAuthority] = PublicKey.findProgramAddressSync(
    [treeAddress.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );

  // Derive the bubblegum signer, used by the Bubblegum program to handle "collection verification"
  // Only used for `createMintToCollectionV1` instruction
  const [bubblegumSigner] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_cpi", "utf8")],
    BUBBLEGUM_PROGRAM_ID
  );

  for (let i = 0; i < amount; i++) {
    // Compressed NFT Metadata
    const compressedNFTMetadata = createCompressedNFTMetadata(payer.publicKey);

    // Create the instruction to "mint" the compressed NFT to the tree
    const mintIx = createMintToCollectionV1Instruction(
      {
        payer: payer.publicKey, // The account that will pay for the transaction
        merkleTree: treeAddress, // The address of the tree account
        treeAuthority, // The authority of the tree account, should be a PDA derived from the tree account address
        treeDelegate: payer.publicKey, // The delegate of the tree account, should be the same as the tree creator by default
        leafOwner: payer.publicKey, // The owner of the compressed NFT being minted to the tree
        leafDelegate: payer.publicKey, // The delegate of the compressed NFT being minted to the tree
        collectionAuthority: payer.publicKey, // The authority of the "collection" NFT
        collectionAuthorityRecordPda: BUBBLEGUM_PROGRAM_ID, // Not sure what this is used for, by default uses Bubblegum program id
        collectionMint: collectionDetails.mint, // The mint of the "collection" NFT
        collectionMetadata: collectionDetails.metadata, // The metadata of the "collection" NFT
        editionAccount: collectionDetails.masterEditionAccount, // The master edition of the "collection" NFT
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        bubblegumSigner,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      },
      {
        metadataArgs: Object.assign(compressedNFTMetadata, {
          collection: { key: collectionDetails.mint, verified: false },
        }),
      }
    );

    try {
      // Create new transaction and add the instruction
      const tx = new Transaction().add(mintIx);

      // Set the fee payer for the transaction
      tx.feePayer = payer.publicKey;

      // Send the transaction
      const txSignature = await sendAndConfirmTransaction(
        connection,
        tx,
        [payer],
        { commitment: "confirmed", skipPreflight: true }
      );

      console.log(
        `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`
      );

      await extractAssetId(connection, txSignature, treeAddress);
    } catch (err) {
      console.error("\nFailed to mint compressed NFT:", err);
      throw err;
    }
  }
}
