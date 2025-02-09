import { mnemonicGenerate } from "@polkadot/util-crypto";
import { waitReady } from "@polkadot/wasm-crypto";
import { Keyring } from "@polkadot/keyring";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { SignerPayloadJSON, ISubmittableResult } from "@polkadot/types/types";
import { SubmittableExtrinsic } from "@polkadot/api/types";

// Modify as necessary
const API_URL = "ws://127.0.0.1:9910";

export const sign = async () => {
	await waitReady();

	const keyring = new Keyring({ type: "sr25519" });
	const mnemonic = mnemonicGenerate();

	const pair = keyring.addFromMnemonic(mnemonic);
	const wallet = pair.toJson();
	const encodedWallet = wallet.encoded;
	const address = wallet.address;

	const provider = new WsProvider(API_URL);
	const api = await ApiPromise.create({ provider });

	const tx = api.tx.assets.create(
		1,
		address,
        1
	);
	const payload = await buildPayload(api, tx, address);
	// Both extrinsicPayload and encodedCall need to be passed
	const newExtrinsicPayload = api.createType('ExtrinsicPayload', payload);
	const extrinsicPayload = newExtrinsicPayload.toHex()
	const encodedCall = tx.toHex();

	// Heads up: doing this or const signer = keyring.createFromJson(wallet) is the same
	const signer = keyring.createFromJson({
		address,
		meta: {},
		encoding: { content: ["pkcs8", "sr25519"], type: ["none"], version: "3" },
		encoded: encodedWallet,
	});
	signer.unlock();
	
	// For doing this fully offline you could use an injected registry
	const signature = newExtrinsicPayload.sign(signer).signature;
	// We pass the encodedSignature

	const call = api.tx(encodedCall)
	const extrinsic = api.registry.createType('Extrinsic', { method: call.method }, { version: call.version });

	extrinsic.addSignature(signer.address, signature, extrinsicPayload);

	try {
		const _ = await api.rpc.author.submitExtrinsic(extrinsic.toHex());
		console.log({
			message: "Call submitted successfully",
		});
	} catch (err: any) {
		console.error({
			message: "Error sending transaction",
			error: err.message,
		});
	}
};

const buildPayload = async (
	api: ApiPromise,
	tx: SubmittableExtrinsic<"promise", ISubmittableResult>
	, // SubmittableExtrinsic, actually
	sender: string
): Promise<SignerPayloadJSON> => {
	const lastHeader = await api.rpc.chain.getHeader();
	const blockNumber = api.registry.createType(
		"BlockNumber",
		lastHeader.number.toNumber()
	);
	const method = api.createType("Call", tx);
	const era = api.registry.createType("ExtrinsicEra", {
		current: lastHeader.number.toNumber(),
		period: 64,
	});

	const nonceRaw =
		((await api.query.system.account(sender)) as any)?.nonce || 0;
	const nonce = api.registry.createType("Compact<Index>", nonceRaw);

	return {
		specVersion: api.runtimeVersion.specVersion.toHex(),
		transactionVersion: api.runtimeVersion.transactionVersion.toHex(),
		address: sender,
		blockHash: lastHeader.hash.toHex(),
		blockNumber: blockNumber.toHex(),
		era: era.toHex(),
		genesisHash: api.genesisHash.toHex(),
		method: method.toHex(),
		nonce: nonce.toHex(),
		signedExtensions: [
			"CheckNonZeroSender",
			"CheckSpecVersion",
			"CheckTxVersion",
			"CheckGenesis",
			"CheckMortality",
			"CheckNonce",
			"CheckWeight",
			"ChargeTransactionPayment",
		],
		tip: api.registry.createType("Compact<Balance>", 0).toHex(),
		version: tx.version,
	};
};
