import type { Chain } from "viem";
import * as c from "viem/chains";

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

const HOUR = 3_600;
const DAY = 86_400;
const OP_STACK_WETH = "0x4200000000000000000000000000000000000006";

export const PRIMARY_NETWORK_KEY = "polygon";
export const PRIMARY_TESTNET_KEY = "polygonAmoy";

export const KNOWN_NATIVE_TOKEN_ALIASES = [
  "0x0000000000000000000000000000000000001010",
  "0x0000000000000000000000000000000000000802",
  "0x471EcE3750Da237f93B8E339c536989b8978a438",
  "0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000",
];

const POLYGON_USDC_FEED = "0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7";
const POLYGON_POL_FEED = "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0";

function polygonToken(address: string, symbol: string, name: string, decimals: number, priceFeed?: string): TokenConfig {
  return { address, symbol, name, decimals, priceFeed };
}

const weth = (address: string): WrappedNativeConfig => ({ address, symbols: ["WETH"] });
const wrapped = (address: string, ...symbols: string[]): WrappedNativeConfig => ({ address, symbols });

const usdc = (address: string, extra: Partial<TokenConfig> = {}): TokenConfig => ({
  address,
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  aliases: ["USDC.e", "USDbC"],
  ...extra,
});
const usdt = (address: string, extra: Partial<TokenConfig> = {}): TokenConfig => ({
  address,
  symbol: "USDT",
  name: "Tether USD",
  decimals: 6,
  aliases: ["USDT0", "USD₮0", "USD₮"],
  ...extra,
});
const wethToken = (address: string, priceFeed?: string): TokenConfig => ({
  address,
  symbol: "WETH",
  name: "Wrapped Ether",
  decimals: 18,
  priceFeed,
});

const ETH_NFT_FEE: [string, string] = ["0.0003", "0.003"];

function network(
  key: string,
  chain: Chain,
  options: Partial<Omit<LiveNetworkConfig, "key" | "chain">> = {},
): LiveNetworkConfig {
  return {
    key,
    chain,
    tokens: [],
    stakingVaults: {},
    minLockDuration: chain.testnet ? HOUR : DAY,
    maxLockDuration: 7300 * DAY,
    nftEarlyUnlockFee: ETH_NFT_FEE,
    ...options,
  };
}

const MAINNETS: LiveNetworkConfig[] = [
  network("ethereum", c.mainnet, {
    wrappedNative: weth("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
    nativePriceFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
    tokens: [
      usdc("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", { priceFeed: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6" }),
      usdt("0xdAC17F958D2ee523a2206206994597C13D831ec7", { priceFeed: "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D" }),
      {
        address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        symbol: "DAI",
        name: "Dai Stablecoin",
        decimals: 18,
        priceFeed: "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9",
      },
      wethToken("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"),
      {
        address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        symbol: "WBTC",
        name: "Wrapped BTC",
        decimals: 8,
        priceFeed: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
      },
      {
        address: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
        symbol: "LINK",
        name: "Chainlink",
        decimals: 18,
        priceFeed: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c",
      },
    ],
  }),
  network("base", c.base, {
    wrappedNative: weth(OP_STACK_WETH),
    nativePriceFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    tokens: [
      usdc("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", { priceFeed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B" }),
      wethToken(OP_STACK_WETH, "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"),
      { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
      { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", symbol: "cbBTC", name: "Coinbase Wrapped BTC", decimals: 8 },
    ],
  }),
  network("arbitrum", c.arbitrum, {
    wrappedNative: weth("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),
    nativePriceFeed: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
    tokens: [
      usdc("0xaf88d065e77c8cC2239327C5EDb3A432268e5831", { priceFeed: "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3" }),
      usdt("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", { priceFeed: "0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7" }),
      wethToken("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612"),
      {
        address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
        symbol: "WBTC",
        name: "Wrapped BTC",
        decimals: 8,
        priceFeed: "0x6ce185860a4963106506C203335A2910413708e9",
      },
      {
        address: "0x912CE59144191C1204E64559FE8253a0e49E6548",
        symbol: "ARB",
        name: "Arbitrum",
        decimals: 18,
        priceFeed: "0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6",
      },
    ],
  }),
  network("arbitrumNova", c.arbitrumNova, { wrappedNative: weth("0x722E8BdD2ce80A4422E880164f2079488e115365") }),
  network("optimism", c.optimism, {
    wrappedNative: weth(OP_STACK_WETH),
    nativePriceFeed: "0x13e3Ee699D1909E989722E753853AE30b17e08c5",
    tokens: [
      usdc("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", { priceFeed: "0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3" }),
      usdt("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58"),
      wethToken(OP_STACK_WETH, "0x13e3Ee699D1909E989722E753853AE30b17e08c5"),
      {
        address: "0x4200000000000000000000000000000000000042",
        symbol: "OP",
        name: "Optimism",
        decimals: 18,
        priceFeed: "0x0D276FC14719f9292D5C1eA2198673d1f4269246",
      },
    ],
  }),
  network("polygon", c.polygon, {
    rpcUrl: "https://polygon.drpc.org",
    wrappedNative: wrapped("0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "WPOL", "WMATIC"),
    nativeTokenAlias: "0x0000000000000000000000000000000000001010",
    nativePriceFeed: POLYGON_POL_FEED,
    nativeFeedPairs: ["POL / USD", "MATIC / USD"],
    nftEarlyUnlockFee: ["12", "120"],
    tokens: [
      usdc("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", { priceFeed: POLYGON_USDC_FEED }),
      {
        ...polygonToken("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", "USDC.e", "USD Coin (bridged)", 6, POLYGON_USDC_FEED),
        aliases: ["USDC"],
        feedPairs: ["USDC / USD"],
      },
      usdt("0xc2132D05D31c914a87C6611C10748AEb04B58e8F", { priceFeed: "0x0A6513e40db6EB1b165753AD52E80663aeA50545" }),
      polygonToken("0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", "DAI", "Dai Stablecoin", 18, "0x4746DeC9e833A82EC7C2C1356372CcF2cfcD2F3D"),
      wethToken("0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", "0xF9680D99D6C9589e2a93a78A04A279e509205945"),
      polygonToken("0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", "WBTC", "Wrapped BTC", 8, "0xc907E116054Ad103354f2D350FD2514433D57F6f"),
      {
        ...polygonToken("0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "WPOL", "Wrapped POL", 18, POLYGON_POL_FEED),
        aliases: ["WMATIC"],
        feedPairs: ["POL / USD", "MATIC / USD"],
      },
      polygonToken("0xd93f7E271cB87c23AaA73edC008A79646d1F9912", "SOL", "Wrapped SOL (Wormhole)", 9, "0x10C8264C0935b3B9870013e057f330Ff3e9C56dC"),
      polygonToken("0x3BA4c387f786bFEE076A58914F5Bd38d668B42c3", "BNB", "BNB (bridged)", 18, "0x82a6c4AF830caa6c97bb504425f6A66165C2c26e"),
      polygonToken("0x2C89bbc92BD86F8075d1DEcc58C7F4E0107f286b", "AVAX", "Avalanche (bridged)", 18, "0xe01eA2fbd8D76ee323FbEd03eB9a8625EC981A10"),
      polygonToken("0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39", "LINK", "Chainlink", 18, "0xd9FFdb71EbE7496cC440152d43986Aae0AB76665"),
      polygonToken("0xD6DF932A45C0f255f85145f286eA0b292B21C90B", "AAVE", "Aave", 18, "0x72484B12719E23115761D5DA1646945632979bB6"),
      polygonToken("0xb33EaAd8d922B1083446DC23f610c2567fB5180f", "UNI", "Uniswap", 18, "0xdf0Fb4e4F928d2dCB76f438575fDD8682386e13C"),
      polygonToken("0x172370d5Cd63279eFa6d502DAB29171933a610AF", "CRV", "Curve DAO", 18, "0x336584C8E6Dc19637A5b36206B1c79923111b405"),
      polygonToken("0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a", "SUSHI", "SushiSwap", 18, "0x49B0c695039243BBfEb8EcD054EB70061fd54aa0"),
      polygonToken("0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3", "BAL", "Balancer", 18, "0xD106B538F2A868c28Ca1Ec7E298C3325E0251d66"),
      polygonToken("0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c", "COMP", "Compound", 18, "0x2A8758b7257102461BC958279054e372C2b1bDE6"),
      polygonToken("0x50B728D8D964fd00C2d0AAD81718b71311feF68a", "SNX", "Synthetix", 18, "0xbF90A5D9B6EE9019028dbFc2a9E50056d5252894"),
      polygonToken("0x9c2C5fd7b07E95EE044DDeba0E97a665F142394f", "1INCH", "1inch", 18, "0x443C5116CdF663Eb387e72C688D276e702135C87"),
      polygonToken("0x5fe2B58c013d7601147DcdD68C143A77499f5531", "GRT", "The Graph", 18, "0x3FabBfb300B1e2D7c9B84512fe9D30aeDF24C410"),
      polygonToken("0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683", "SAND", "The Sandbox", 18, "0x3D49406EDd4D52Fb7FFd25485f32E073b529C924"),
      polygonToken("0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4", "MANA", "Decentraland", 18, "0xA1CbF3Fe43BC3501e3Fc4b573e822c70e76A7512"),
      polygonToken("0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7", "GHST", "Aavegotchi", 18, "0xDD229Ce42f11D8Ee7fFf29bDB71C7b81352e11be"),
      polygonToken("0xB7b31a6BC18e48888545CE79e83E06003bE70930", "APE", "ApeCoin", 18, "0x2Ac3F3Bfac8fC9094BC3f0F9041a51375235B992"),
      polygonToken("0x6f8a06447Ff6FcF75d803135a7de15CE88C1d4ec", "SHIB", "Shiba Inu", 18, "0x3710abeb1A0Fc7C2EC59C26c8DAA7a448ff6125A"),
      polygonToken("0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD", "wstETH", "Wrapped liquid staked Ether", 18),
      polygonToken("0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6", "MaticX", "Liquid Staking POL (Stader)", 18),
      polygonToken("0xC3C7d422809852031b44ab29EEC9F1EfF2A58756", "LDO", "Lido DAO", 18),
      polygonToken("0x6f7C932e7684666C9fd1d44527765433e01fF61d", "MKR", "Maker", 18),
      polygonToken("0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89", "FRAX", "Frax", 18),
      polygonToken("0xB5C064F955D8e7F38fE0460C556a72987494eE17", "QUICK", "QuickSwap", 18),
      polygonToken("0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32", "TEL", "Telcoin", 2),
      polygonToken("0xE111178A87A3BFf0c8d18DECBa5798827539Ae99", "EURS", "STASIS EURS", 2),
      { ...polygonToken("0xE0B52e49357Fd4DAf2c15e02058DCE6BC0057db4", "EURA", "EURA (Angle)", 18), aliases: ["agEUR"] },
    ],
  }),
  network("bsc", c.bsc, {
    wrappedNative: wrapped("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", "WBNB"),
    nativePriceFeed: "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE",
    nftEarlyUnlockFee: ["0.001", "0.01"],
    tokens: [
      usdt("0x55d398326f99059fF775485246999027B3197955", { decimals: 18, priceFeed: "0xB97Ad0E74fa7d920791E90258A6E2085088b4320" }),
      usdc("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", { decimals: 18, priceFeed: "0x51597f405303C4377E36123cBc172b13269EA163" }),
      {
        address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
        symbol: "ETH",
        name: "Ethereum Token",
        decimals: 18,
        priceFeed: "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e",
      },
      {
        address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
        symbol: "BTCB",
        name: "Bitcoin BEP2",
        decimals: 18,
        priceFeed: "0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf",
        feedPairs: ["BTC / USD"],
      },
    ],
  }),
  network("opBNB", c.opBNB, { wrappedNative: wrapped(OP_STACK_WETH, "WBNB"), nftEarlyUnlockFee: ["0.001", "0.01"] }),
  network("avalanche", c.avalanche, {
    wrappedNative: wrapped("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", "WAVAX"),
    nativePriceFeed: "0x0A77230d17318075983913bC2145DB16C7366156",
    nftEarlyUnlockFee: ["0.05", "0.5"],
    tokens: [
      usdc("0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", { priceFeed: "0xF096872672F44d6EBA71458D74fe67F9a77a23B9" }),
      usdt("0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", { priceFeed: "0xEBE676ee90Fe1112671f19b6B7459bC678B67e8a" }),
    ],
  }),
  network("gnosis", c.gnosis, {
    wrappedNative: wrapped("0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d", "WXDAI"),
    nativePriceFeed: "0x678df3415fc31947dA4324eC63212874be5a82f8",
    nativeFeedPairs: ["DAI / USD", "XDAI / USD"],
    nftEarlyUnlockFee: ["1", "10"],
    tokens: [wethToken("0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", "0xa767f745331D267c7751297D982b050c93985627")],
  }),
  network("linea", c.linea, {
    wrappedNative: weth("0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f"),
    tokens: [usdc("0x176211869cA2b568f2A7D4EE941E073a821EE1ff")],
  }),
  network("scroll", c.scroll, {
    wrappedNative: weth("0x5300000000000000000000000000000000000004"),
    tokens: [usdc("0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4")],
  }),
  network("celo", c.celo, {
    nativeTokenAlias: "0x471EcE3750Da237f93B8E339c536989b8978a438",
    nftEarlyUnlockFee: ["2", "20"],
    tokens: [usdc("0xcebA9300f2b948710d2653dD7B07f33A8B32118C")],
  }),
  network("zora", c.zora, { wrappedNative: weth(OP_STACK_WETH) }),
  network("mode", c.mode, { wrappedNative: weth(OP_STACK_WETH) }),
  network("blast", c.blast, {
    wrappedNative: weth("0x4300000000000000000000000000000000000004"),
    tokens: [{ address: "0x4300000000000000000000000000000000000003", symbol: "USDB", name: "USDB", decimals: 18 }],
  }),
  network("mantle", c.mantle, {
    wrappedNative: wrapped("0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8", "WMNT"),
    nftEarlyUnlockFee: ["1", "10"],
    tokens: [usdc("0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9"), usdt("0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE")],
  }),
  network("sonic", c.sonic, {
    wrappedNative: wrapped("0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38", "wS"),
    nftEarlyUnlockFee: ["3", "30"],
    tokens: [usdc("0x29219dd400f2Bf60E5a23d13Be72B486D4038894")],
  }),
  network("unichain", c.unichain, {
    wrappedNative: weth(OP_STACK_WETH),
    tokens: [usdc("0x078D782b760474a361dDA0AF3839290b0EF57AD6")],
  }),
  network("ink", c.ink, { wrappedNative: weth(OP_STACK_WETH) }),
  network("soneium", c.soneium, { wrappedNative: weth(OP_STACK_WETH) }),
  network("worldchain", c.worldchain, {
    wrappedNative: weth(OP_STACK_WETH),
    tokens: [
      usdc("0x79A02482A880bCE3F13e09Da970dC34db4CD24d1"),
      { address: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003", symbol: "WLD", name: "Worldcoin", decimals: 18 },
    ],
  }),
  network("lisk", c.lisk, { wrappedNative: weth(OP_STACK_WETH) }),
  network("berachain", c.berachain, {
    wrappedNative: wrapped("0x6969696969696969696969696969696969696969", "WBERA"),
    nftEarlyUnlockFee: ["0.5", "5"],
    tokens: [{ address: "0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce", symbol: "HONEY", name: "Honey", decimals: 18 }],
  }),
  network("moonbeam", c.moonbeam, {
    wrappedNative: wrapped("0xAcc15dC74880C9944775448304B263D191c6077F", "WGLMR"),
    nativeTokenAlias: "0x0000000000000000000000000000000000000802",
    nftEarlyUnlockFee: ["10", "100"],
  }),
  network("moonriver", c.moonriver, {
    wrappedNative: wrapped("0x98878B06940aE243284CA214f92Bb71a2b032B8A", "WMOVR"),
    nativeTokenAlias: "0x0000000000000000000000000000000000000802",
    nftEarlyUnlockFee: ["0.1", "1"],
  }),
  network("cronos", c.cronos, {
    wrappedNative: wrapped("0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23", "WCRO"),
    nftEarlyUnlockFee: ["10", "100"],
  }),
  network("metis", c.metis, { nftEarlyUnlockFee: ["0.05", "0.5"] }),
  network("kava", c.kava, {
    wrappedNative: wrapped("0xc86c7C0eFbd6A49B35E8714C5f59D99De09A225b", "WKAVA"),
    nftEarlyUnlockFee: ["3", "30"],
  }),
  network("taiko", c.taiko, { wrappedNative: weth("0xA51894664A773981C6C112C43ce576f315d5b1B6") }),
  network("manta", c.manta, { wrappedNative: weth("0x0Dc808adcE2099A9F62AA87D9670745AbA741746") }),
  network("hyperEvm", c.hyperEvm, {
    wrappedNative: wrapped("0x5555555555555555555555555555555555555555", "WHYPE"),
    nftEarlyUnlockFee: ["0.05", "0.5"],
  }),
  network("monad", c.monad, { nftEarlyUnlockFee: ["1", "10"] }),
  network("sei", c.sei, {
    wrappedNative: wrapped("0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7", "WSEI"),
    nftEarlyUnlockFee: ["5", "50"],
  }),
  network("plasma", c.plasma, { nftEarlyUnlockFee: ["2", "20"] }),
  network("katana", c.katana),
  network("megaeth", c.megaeth, { wrappedNative: weth(OP_STACK_WETH) }),
  network("flow", c.flowMainnet, {
    wrappedNative: wrapped("0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e", "WFLOW"),
    nftEarlyUnlockFee: ["3", "30"],
  }),
  network("apeChain", c.apeChain, {
    wrappedNative: wrapped("0x48b62137EdfA95a428D35C09E44256a739F6B557", "WAPE"),
    nftEarlyUnlockFee: ["2", "20"],
  }),
  network("kaia", c.kaia, {
    wrappedNative: wrapped("0x19Aac5f612f524B754CA7e7c41cbFa2E981A4432", "WKAIA", "WKLAY"),
    nftEarlyUnlockFee: ["10", "100"],
  }),
  network("xLayer", c.xLayer, {
    wrappedNative: wrapped("0xe538905cf8410324e03A5A23C1c177a474D59b2b", "WOKB"),
    nftEarlyUnlockFee: ["0.01", "0.1"],
  }),
  network("morph", c.morph),
  network("bob", c.bob, { wrappedNative: weth(OP_STACK_WETH) }),
  network("hemi", c.hemi, { wrappedNative: weth(OP_STACK_WETH) }),
  network("swellchain", c.swellchain, { wrappedNative: weth(OP_STACK_WETH) }),
  network("superseed", c.superseed, { wrappedNative: weth(OP_STACK_WETH) }),
  network("shape", c.shape, { wrappedNative: weth(OP_STACK_WETH) }),
  network("b3", c.b3, { wrappedNative: weth(OP_STACK_WETH) }),
  network("degen", c.degen, { nftEarlyUnlockFee: ["300", "3000"] }),
  network("cyber", c.cyber, { wrappedNative: weth(OP_STACK_WETH) }),
  network("zircuit", c.zircuit, { wrappedNative: weth(OP_STACK_WETH) }),
  network("mint", c.mint, { wrappedNative: weth(OP_STACK_WETH) }),
  network("metalL2", c.metalL2, { wrappedNative: weth(OP_STACK_WETH) }),
  network("boba", c.boba),
  network("fuse", c.fuse, {
    wrappedNative: wrapped("0x0BE9e53fd7EDaC9F859882AfdDa116645287C629", "WFUSE"),
    nftEarlyUnlockFee: ["30", "300"],
  }),
  network("telos", c.telos, {
    wrappedNative: wrapped("0xD102cE6A4dB07D247fcc28F366A623Df0938CA9E", "WTLOS"),
    nftEarlyUnlockFee: ["10", "100"],
  }),
  network("rootstock", c.rootstock, {
    wrappedNative: wrapped("0x542fDA317318eBF1d3DEAf76E0b632741A7e677d", "WRBTC"),
    nftEarlyUnlockFee: ["0.00001", "0.0001"],
  }),
  network("aurora", c.aurora, { wrappedNative: weth("0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB") }),
  network("iota", c.iota, { nftEarlyUnlockFee: ["10", "100"] }),
  network("lightlink", c.lightlinkPhoenix),
  network("fraxtal", c.fraxtal, { nftEarlyUnlockFee: ["1", "10"] }),
  network("corn", c.corn, { nftEarlyUnlockFee: ["0.00001", "0.0001"] }),
];

const TESTNETS: LiveNetworkConfig[] = [
  network("sepolia", c.sepolia, {
    wrappedNative: weth("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"),
    nativePriceFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    tokens: [
      usdc("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", { priceFeed: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E" }),
      {
        address: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
        symbol: "LINK",
        name: "Chainlink",
        decimals: 18,
        priceFeed: "0xc59E3633BAAC79493d908e63626716e204A45EdF",
      },
      wethToken("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", "0x694AA1769357215DE4FAC081bf1f309aDC325306"),
    ],
  }),
  network("hoodi", c.hoodi),
  network("baseSepolia", c.baseSepolia, {
    wrappedNative: weth(OP_STACK_WETH),
    nativePriceFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
    tokens: [
      usdc("0x036CbD53842c5426634e7929541eC2318f3dCF7e", { priceFeed: "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165" }),
      wethToken(OP_STACK_WETH, "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1"),
    ],
  }),
  network("arbitrumSepolia", c.arbitrumSepolia, {
    wrappedNative: weth("0x980B62Da83eFf3D4576C647993b0c1D7faf17c73"),
    tokens: [usdc("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d")],
  }),
  network("optimismSepolia", c.optimismSepolia, {
    wrappedNative: weth(OP_STACK_WETH),
    tokens: [usdc("0x5fd84259d66Cd46123540766Be93DFE6D43130D7")],
  }),
  network("polygonAmoy", c.polygonAmoy, {
    rpcUrl: "https://polygon-amoy.drpc.org",
    wrappedNative: wrapped("0x360ad4f9a9A8EFe9A8DCB5f461c4Cc1047E1Dcf9", "WPOL", "WMATIC"),
    nativeTokenAlias: "0x0000000000000000000000000000000000001010",
    nftEarlyUnlockFee: ["0.01", "0.1"],
    tokens: [
      usdc("0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", { priceFeed: "0x1b8739bB4CdF0089d07097A9Ae5Bd274b29C6F16" }),
      {
        address: "0x0Fd9e8d3aF1aaee056EB9e802c3A762a667b1904",
        symbol: "LINK",
        name: "Chainlink",
        decimals: 18,
        priceFeed: "0xc2e2848e28B9fE430Ab44F55a8437a33802a219C",
      },
      { address: "0x360ad4f9a9A8EFe9A8DCB5f461c4Cc1047E1Dcf9", symbol: "WPOL", name: "Wrapped POL", decimals: 18, aliases: ["WMATIC"] },
    ],
  }),
  network("bscTestnet", c.bscTestnet, {
    wrappedNative: wrapped("0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", "WBNB"),
    nftEarlyUnlockFee: ["0.001", "0.01"],
  }),
  network("opBNBTestnet", c.opBNBTestnet, {
    wrappedNative: wrapped(OP_STACK_WETH, "WBNB"),
    nftEarlyUnlockFee: ["0.001", "0.01"],
  }),
  network("avalancheFuji", c.avalancheFuji, {
    wrappedNative: wrapped("0xd00ae08403B9bbb9124bB305C09058E32C39A48c", "WAVAX"),
    nftEarlyUnlockFee: ["0.05", "0.5"],
    tokens: [usdc("0x5425890298aed601595a70AB815c96711a31Bc65")],
  }),
  network("gnosisChiado", c.gnosisChiado, {
    wrappedNative: wrapped("0xb2D0d7aD1D4b2915390Dc7053b9421F735A723E7", "WXDAI"),
    nftEarlyUnlockFee: ["1", "10"],
  }),
  network("lineaSepolia", c.lineaSepolia),
  network("scrollSepolia", c.scrollSepolia, { wrappedNative: weth("0x5300000000000000000000000000000000000004") }),
  network("celoSepolia", c.celoSepolia, { nftEarlyUnlockFee: ["2", "20"] }),
  network("zoraSepolia", c.zoraSepolia, { wrappedNative: weth(OP_STACK_WETH) }),
  network("modeTestnet", c.modeTestnet, { wrappedNative: weth(OP_STACK_WETH) }),
  network("blastSepolia", c.blastSepolia, { wrappedNative: weth("0x4300000000000000000000000000000000000004") }),
  network("mantleSepolia", c.mantleSepoliaTestnet, { nftEarlyUnlockFee: ["1", "10"] }),
  network("sonicBlaze", c.sonicBlazeTestnet, { nftEarlyUnlockFee: ["3", "30"] }),
  network("unichainSepolia", c.unichainSepolia, { wrappedNative: weth(OP_STACK_WETH) }),
  network("inkSepolia", c.inkSepolia, { wrappedNative: weth(OP_STACK_WETH) }),
  network("soneiumMinato", c.soneiumMinato, { wrappedNative: weth(OP_STACK_WETH) }),
  network("worldchainSepolia", c.worldchainSepolia, { wrappedNative: weth(OP_STACK_WETH) }),
  network("liskSepolia", c.liskSepolia, { wrappedNative: weth(OP_STACK_WETH) }),
  network("berachainBepolia", c.berachainBepolia, {
    wrappedNative: wrapped("0x6969696969696969696969696969696969696969", "WBERA"),
    nftEarlyUnlockFee: ["0.5", "5"],
  }),
  network("moonbaseAlpha", c.moonbaseAlpha, {
    wrappedNative: wrapped("0xD909178CC99d318e4D46e7E66a972955859670E1", "WDEV"),
    nativeTokenAlias: "0x0000000000000000000000000000000000000802",
    nftEarlyUnlockFee: ["10", "100"],
  }),
  network("cronosTestnet", c.cronosTestnet, { nftEarlyUnlockFee: ["10", "100"] }),
  network("monadTestnet", c.monadTestnet, {
    wrappedNative: wrapped("0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701", "WMON"),
    nftEarlyUnlockFee: ["1", "10"],
  }),
  network("seiTestnet", c.seiTestnet, { nftEarlyUnlockFee: ["5", "50"] }),
];

export const LIVE_NETWORKS: Record<number, LiveNetworkConfig> = Object.fromEntries(
  [...MAINNETS, ...TESTNETS].map((n) => [n.chain.id, n]),
);

export function orderedNetworks(): LiveNetworkConfig[] {
  const rank = (n: LiveNetworkConfig) =>
    n.key === PRIMARY_NETWORK_KEY ? 0 : n.key === PRIMARY_TESTNET_KEY ? 1 : n.chain.testnet ? 3 : 2;
  return Object.values(LIVE_NETWORKS).sort((a, b) => rank(a) - rank(b) || a.chain.name.localeCompare(b.chain.name));
}

export function findNetwork(keyOrNumber: string): LiveNetworkConfig | undefined {
  const ordered = orderedNetworks();
  const value = keyOrNumber.trim();
  if (/^\d+$/.test(value)) return ordered[Number(value) - 1];
  return ordered.find((n) => n.key.toLowerCase() === value.toLowerCase());
}
