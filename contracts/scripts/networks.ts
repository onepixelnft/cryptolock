import type { Chain } from "viem";
import { polygon } from "viem/chains";

export interface TokenConfig {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  aliases?: string[];
  priceFeed?: string;
  feedPairs?: string[];
}

export interface WrappedNativeConfig {
  address: string;
  symbols: string[];
}

export interface LiveNetworkConfig {
  key: string;
  chain: Chain;
  rpcUrl?: string;
  wrappedNative?: WrappedNativeConfig;
  nativeTokenAlias?: string;
  nativePriceFeed?: string;
  nativeFeedPairs?: string[];
  tokens: TokenConfig[];
  stakingVaults: Record<string, string>;
  minLockDuration: number;
  maxLockDuration: number;
  nftEarlyUnlockFee: [string, string];
}

const DAY = 86_400;

export const PRIMARY_NETWORK_KEY = "polygon";

export const KNOWN_NATIVE_TOKEN_ALIASES = ["0x0000000000000000000000000000000000001010"];

const USDC_FEED = "0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7";
const POL_FEED = "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0";

function token(address: string, symbol: string, name: string, decimals: number, priceFeed?: string): TokenConfig {
  return { address, symbol, name, decimals, priceFeed };
}

const POLYGON: LiveNetworkConfig = {
  key: PRIMARY_NETWORK_KEY,
  chain: polygon,
  rpcUrl: "https://polygon.drpc.org",
  wrappedNative: { address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", symbols: ["WPOL", "WMATIC"] },
  nativeTokenAlias: "0x0000000000000000000000000000000000001010",
  nativePriceFeed: POL_FEED,
  nativeFeedPairs: ["POL / USD", "MATIC / USD"],
  stakingVaults: {},
  minLockDuration: DAY,
  maxLockDuration: 7300 * DAY,
  nftEarlyUnlockFee: ["12", "120"],
  tokens: [
    { ...token("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "USDC", "USD Coin", 6, USDC_FEED), aliases: ["USDC.e", "USDbC"] },
    { ...token("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", "USDC.e", "USD Coin (bridged)", 6, USDC_FEED), aliases: ["USDC"], feedPairs: ["USDC / USD"] },
    {
      ...token("0xc2132D05D31c914a87C6611C10748AEb04B58e8F", "USDT", "Tether USD", 6, "0x0A6513e40db6EB1b165753AD52E80663aeA50545"),
      aliases: ["USDT0", "USD₮0", "USD₮"],
    },
    token("0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", "DAI", "Dai Stablecoin", 18, "0x4746DeC9e833A82EC7C2C1356372CcF2cfcD2F3D"),
    token("0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", "WETH", "Wrapped Ether", 18, "0xF9680D99D6C9589e2a93a78A04A279e509205945"),
    token("0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", "WBTC", "Wrapped BTC", 8, "0xc907E116054Ad103354f2D350FD2514433D57F6f"),
    { ...token("0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "WPOL", "Wrapped POL", 18, POL_FEED), aliases: ["WMATIC"], feedPairs: ["POL / USD", "MATIC / USD"] },
    token("0xd93f7E271cB87c23AaA73edC008A79646d1F9912", "SOL", "Wrapped SOL (Wormhole)", 9, "0x10C8264C0935b3B9870013e057f330Ff3e9C56dC"),
    token("0x3BA4c387f786bFEE076A58914F5Bd38d668B42c3", "BNB", "BNB (bridged)", 18, "0x82a6c4AF830caa6c97bb504425f6A66165C2c26e"),
    token("0x2C89bbc92BD86F8075d1DEcc58C7F4E0107f286b", "AVAX", "Avalanche (bridged)", 18, "0xe01eA2fbd8D76ee323FbEd03eB9a8625EC981A10"),
    token("0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39", "LINK", "Chainlink", 18, "0xd9FFdb71EbE7496cC440152d43986Aae0AB76665"),
    token("0xD6DF932A45C0f255f85145f286eA0b292B21C90B", "AAVE", "Aave", 18, "0x72484B12719E23115761D5DA1646945632979bB6"),
    token("0xb33EaAd8d922B1083446DC23f610c2567fB5180f", "UNI", "Uniswap", 18, "0xdf0Fb4e4F928d2dCB76f438575fDD8682386e13C"),
    token("0x172370d5Cd63279eFa6d502DAB29171933a610AF", "CRV", "Curve DAO", 18, "0x336584C8E6Dc19637A5b36206B1c79923111b405"),
    token("0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a", "SUSHI", "SushiSwap", 18, "0x49B0c695039243BBfEb8EcD054EB70061fd54aa0"),
    token("0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3", "BAL", "Balancer", 18, "0xD106B538F2A868c28Ca1Ec7E298C3325E0251d66"),
    token("0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c", "COMP", "Compound", 18, "0x2A8758b7257102461BC958279054e372C2b1bDE6"),
    token("0x50B728D8D964fd00C2d0AAD81718b71311feF68a", "SNX", "Synthetix", 18, "0xbF90A5D9B6EE9019028dbFc2a9E50056d5252894"),
    token("0x9c2C5fd7b07E95EE044DDeba0E97a665F142394f", "1INCH", "1inch", 18, "0x443C5116CdF663Eb387e72C688D276e702135C87"),
    token("0x5fe2B58c013d7601147DcdD68C143A77499f5531", "GRT", "The Graph", 18, "0x3FabBfb300B1e2D7c9B84512fe9D30aeDF24C410"),
    token("0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683", "SAND", "The Sandbox", 18, "0x3D49406EDd4D52Fb7FFd25485f32E073b529C924"),
    token("0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4", "MANA", "Decentraland", 18, "0xA1CbF3Fe43BC3501e3Fc4b573e822c70e76A7512"),
    token("0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7", "GHST", "Aavegotchi", 18, "0xDD229Ce42f11D8Ee7fFf29bDB71C7b81352e11be"),
    token("0xB7b31a6BC18e48888545CE79e83E06003bE70930", "APE", "ApeCoin", 18, "0x2Ac3F3Bfac8fC9094BC3f0F9041a51375235B992"),
    token("0x6f8a06447Ff6FcF75d803135a7de15CE88C1d4ec", "SHIB", "Shiba Inu", 18, "0x3710abeb1A0Fc7C2EC59C26c8DAA7a448ff6125A"),
    token("0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD", "wstETH", "Wrapped liquid staked Ether", 18),
    token("0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6", "MaticX", "Liquid Staking POL (Stader)", 18),
    token("0xC3C7d422809852031b44ab29EEC9F1EfF2A58756", "LDO", "Lido DAO", 18),
    token("0x6f7C932e7684666C9fd1d44527765433e01fF61d", "MKR", "Maker", 18),
    token("0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89", "FRAX", "Frax", 18),
    token("0xB5C064F955D8e7F38fE0460C556a72987494eE17", "QUICK", "QuickSwap", 18),
    token("0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32", "TEL", "Telcoin", 2),
    token("0xE111178A87A3BFf0c8d18DECBa5798827539Ae99", "EURS", "STASIS EURS", 2),
    { ...token("0xE0B52e49357Fd4DAf2c15e02058DCE6BC0057db4", "EURA", "EURA (Angle)", 18), aliases: ["agEUR"] },
  ],
};

export const LIVE_NETWORKS: Record<number, LiveNetworkConfig> = { [POLYGON.chain.id]: POLYGON };

export function orderedNetworks(): LiveNetworkConfig[] {
  return [POLYGON];
}

export function findNetwork(keyOrNumber: string): LiveNetworkConfig | undefined {
  const value = keyOrNumber.trim().toLowerCase();
  return value === "1" || value === POLYGON.key ? POLYGON : undefined;
}
