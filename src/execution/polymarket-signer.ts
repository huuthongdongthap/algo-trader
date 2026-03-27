/**
 * Polymarket ECDSA Order Signer
 * EIP-712 typed data signing for Polymarket CLOB orders on Polygon (chainId 137).
 * Docs: https://docs.polymarket.com/#signing-orders
 *
 * NOTE: Actual ECDSA signing is stubbed — requires ethers.js or viem at runtime.
 * TODO: Install ethers@6 and replace stub with: wallet.signTypedData(domain, types, value)
 */

/** Polymarket CLOB order (unsigned) */
export interface PolymarketOrder {
  /** Token ID (YES or NO outcome token address) */
  tokenId: string;
  /** Limit price as a decimal between 0 and 1 (e.g. 0.65 = 65 cents) */
  price: number;
  /** Order size in USDC (6 decimals) */
  size: number;
  /** Order side */
  side: 'BUY' | 'SELL';
  /** Unix timestamp (seconds) after which the order expires; 0 = GTC */
  expiration: number;
  /** Unique order nonce (prevents replay) */
  nonce: string;
  /** Fee rate in basis points */
  feeRateBps: number;
  /**
   * Signature type:
   * 0 = EOA (standard ECDSA)
   * 1 = POLY_PROXY (Polymarket proxy wallet)
   * 2 = POLY_GNOSIS_SAFE
   */
  signatureType: 0 | 1 | 2;
}

/** Signed order ready for submission to CLOB API */
export interface SignedOrder extends PolymarketOrder {
  /** Hex-encoded EIP-712 signature */
  signature: string;
  /** Signer address (checksum) */
  maker: string;
}

/** EIP-712 domain separator for Polymarket CTF Exchange */
export interface TypedDataDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

/** EIP-712 field descriptor */
export interface TypedDataField {
  name: string;
  type: string;
}

/** Full EIP-712 typed data structure */
export interface OrderTypedData {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/** Polymarket CTF Exchange contract on Polygon */
const CTF_EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';

/**
 * Signs Polymarket CLOB orders using EIP-712 typed data.
 * Chain: Polygon mainnet (chainId 137).
 */
export class PolymarketSigner {
  private readonly chainId: number;
  private readonly privateKey: string;

  /**
   * @param privateKey - Hex private key (with or without 0x prefix)
   * @param chainId    - Polygon chain ID (default: 137 mainnet, 80001 = Mumbai testnet)
   */
  /** Returns true if key is a placeholder/paper-trading value, not a real private key */
  static isPaperKey(key: string): boolean {
    if (!key) return true;
    const normalized = key.toLowerCase().replace(/^0x/, '');
    // Placeholder patterns: non-hex characters, too short, or known paper-key strings
    if (/[^0-9a-f]/.test(normalized)) return true;
    if (normalized.length !== 64) return true;
    // All-zeros is also invalid
    if (/^0+$/.test(normalized)) return true;
    return false;
  }

  constructor(privateKey: string, chainId: number = 137) {
    if (!privateKey) throw new Error('privateKey is required');
    if (PolymarketSigner.isPaperKey(privateKey)) {
      throw new Error(
        `Invalid private key: "${privateKey}" looks like a placeholder. ` +
        'Set POLY_PRIVATE_KEY to a valid 32-byte hex key or run in paper-trading mode.'
      );
    }
    this.privateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    this.chainId = chainId;
  }

  /**
   * Sign an order using EIP-712 typed data.
   * @param order - Unsigned Polymarket order
   * @returns Signed order with signature and maker address attached
   * TODO: Replace stub with: const wallet = new ethers.Wallet(this.privateKey);
   *       return wallet.signTypedData(typed.domain, typed.types, typed.message);
   */
  async signOrder(order: PolymarketOrder): Promise<SignedOrder> {
    this.buildTypedData(order); // validates structure
    const hash = this.createOrderHash(order);

    // TODO: implement with ethers.js — stub returns deterministic placeholder
    const signature = await this._stubSign(hash);
    const maker = this._stubGetAddress();

    return { ...order, signature, maker };
  }

  /**
   * Build EIP-712 typed data for a CLOB order.
   * @param order - The order to encode
   */
  buildTypedData(order: PolymarketOrder): OrderTypedData {
    return {
      domain: {
        name: 'Polymarket CTF Exchange',
        version: '1',
        chainId: this.chainId,
        verifyingContract: CTF_EXCHANGE_ADDRESS,
      },
      types: {
        Order: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'makerAmount', type: 'uint256' },
          { name: 'takerAmount', type: 'uint256' },
          { name: 'expiration', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'feeRateBps', type: 'uint256' },
          { name: 'side', type: 'uint8' },
          { name: 'signatureType', type: 'uint8' },
        ],
      },
      primaryType: 'Order',
      message: {
        tokenId: order.tokenId,
        makerAmount: Math.round(order.size * 1e6).toString(),
        takerAmount: Math.round(order.size * order.price * 1e6).toString(),
        expiration: order.expiration.toString(),
        nonce: order.nonce,
        feeRateBps: order.feeRateBps.toString(),
        side: order.side === 'BUY' ? 0 : 1,
        signatureType: order.signatureType,
      },
    };
  }

  /**
   * Create a deterministic order hash string for deduplication / logging.
   * TODO: Replace with proper keccak256(encodeData(typed)) via ethers.js
   */
  createOrderHash(order: PolymarketOrder): string {
    const raw = `${order.tokenId}:${order.price}:${order.size}:${order.side}:${order.nonce}`;
    // TODO: return ethers.TypedDataEncoder.hash(domain, types, message)
    return `0x${Buffer.from(raw).toString('hex').slice(0, 64).padEnd(64, '0')}`;
  }

  /** Generate a random nonce string */
  generateNonce(): string {
    return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString();
  }

  // ── Stubs (replace with ethers.js) ─────────────────────────────────────────

  /** @internal stub — replace with wallet.signTypedData() */
  private async _stubSign(_hash: string): Promise<string> {
    // TODO: const wallet = new ethers.Wallet(this.privateKey);
    //       return wallet.signTypedData(domain, types, value);
    throw new Error('Signing not implemented — install ethers.js and replace _stubSign()');
  }

  /** @internal stub — replace with ethers.Wallet.computeAddress(this.privateKey) */
  private _stubGetAddress(): string {
    return '0x0000000000000000000000000000000000000000';
  }
}
