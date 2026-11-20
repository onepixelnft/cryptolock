import type { Lang } from "@/lib/preferences";

export interface ProseSection {
  title: string;
  paragraphs?: string[];
  list?: string[];
}

export interface ProsePage {
  title: string;
  lead: string;
  sections: ProseSection[];
}

export const docs: Record<Lang, ProsePage> = {
  en: {
    title: "Documentation",
    lead: "How locks work, what the contracts enforce, and how fees and staking are calculated.",
    sections: [
      {
        title: "Two ways to lock",
        paragraphs: [
          "Crypto Lock locks a specific token (or the network's native coin) in the LockVault smart contract until a date you choose.",
          "Wallet Lock locks a whole Lock Account — a smart account owned by your wallet — so that nothing can leave it until the unlock date.",
        ],
      },
      {
        title: "Crypto Lock",
        list: [
          "You choose a token, an amount, a duration and optionally staking, then sign the transaction in your wallet.",
          "The tokens are transferred to LockVault, which records the owner, token, amount, start date, unlock date and the early-unlock fee terms.",
          "Each lock is independent: you can hold as many simultaneous locks as you want.",
          "At or after the unlock date, Unlock at Maturity returns everything to you. Before it, Unlock Early returns the amount minus the early-unlock fee.",
          "Nobody else — including the protocol administrator — can move locked funds. Pausing the protocol only stops new locks; withdrawals always remain available.",
        ],
      },
      {
        title: "NFT Lock",
        list: [
          "Locks an ERC-721 token, or a number of units of an ERC-1155 token, in the NftLockVault contract until a date you choose.",
          "ERC-721: only the chosen token is approved for the vault. ERC-1155 has no per-token approval, so the collection is approved for the vault — which can only use it when you call lock yourself.",
          "Early unlock is paid in the network's native coin: the fee decreases linearly from the maximum to the minimum, both copied into the lock when you create it. Anything sent above the exact fee is refunded in the same transaction.",
          "NFTs sent directly to the vault are refused, so nothing can get stuck there. Staking is not available for NFTs.",
        ],
      },
      {
        title: "Networks and tokens",
        list: [
          "The main network is Polygon, offered first everywhere; Polygon Amoy is its test network.",
          "The production contracts avoid the most recent EVM opcodes, so they run on any EVM network. The app knows about some ninety networks; a network becomes usable as soon as the protocol is deployed on it, the others are listed as not deployed.",
          "zkSync-based networks (zkSync Era, Abstract) are not supported: they do not run standard EVM bytecode.",
          "Every ERC-20 token can be locked, without any list. The tokens your wallet holds are detected automatically; any other one can be added by contract address in the creation flow (it is remembered on your device). Tokens without a reliable price feed are shown without a dollar value.",
          "Tokens whose balances change on their own work as expected: the locks of a token share a pool, so a rebase or a reflection (stETH, aTokens, reflection tokens…) goes to each lock pro rata, and fee-on-transfer tokens are recorded as actually received.",
          "Coins of other blockchains (Bitcoin, Solana, XRP…) cannot be held by an EVM contract as such: lock their version issued on the network instead, such as WBTC for bitcoin or Wormhole SOL on Polygon.",
          "On networks where an ERC-20 contract mirrors the native coin (POL on Polygon, CELO on Celo…), the native coin is locked directly and that mirror is refused, so the two can never be mixed up.",
        ],
      },
      {
        title: "Wallet Lock",
        paragraphs: [
          "A wallet secured by a private key (an EOA such as MetaMask) can always sign transactions. No website or contract can prevent that, so this app never claims to freeze such a wallet.",
          "Wallet Lock therefore uses a Lock Account: a minimal smart account owned by your wallet, deployed at an address derived from your wallet address. You deposit the assets you want to protect into it. While it is locked, the account itself rejects, on-chain:",
        ],
        list: [
          "every outgoing call: transfers of tokens or coins, approvals, interactions with any contract;",
          "every signature: ERC-1271 is disabled at all times, so no permit, Permit2 signature transfer or off-chain order can authorise a transfer;",
          "ownership transfers (the time-delayed recovery can change the owner, but never ends a lock).",
        ],
      },
      {
        title: "Approvals and indirect transfers",
        paragraphs: [
          "The Lock Account records every approval it grants — ERC-20 allowances, ERC-721 and ERC-1155 approvals, ERC-777 operators, ERC-6909 operators and allowances — including approvals wrapped in a multicall. After each call it reads the real on-chain state. A lock cannot start while one of them is still live, so no third party can pull assets during the lock. The app lists live approvals and lets you revoke them before locking.",
          "Limits, stated plainly: assets outside the Lock Account are not locked; protocol-specific delegations that are not standard token approvals, ERC-777 default operators and positions that a third-party protocol can liquidate are outside what the account can control.",
        ],
      },
      {
        title: "Early unlock fee",
        paragraphs: [
          "Fee rate = minimum + (maximum − minimum) × remaining time ÷ total duration. It decreases linearly from the maximum (right after locking) to the minimum (just before the unlock date), and is zero at maturity.",
          "The minimum and maximum are copied into each lock when it is created and can never change for that lock. The protocol enforces a hard ceiling of 20%.",
          "Example with the default terms (1% to 5%): 5,000 USDC locked for 90 days, unlocked with 45 days left → 1% + 4% × 45/90 = 3% → fee 150 USDC, 4,850 USDC received.",
          "For a Crypto Lock the fee is taken in the locked token. For a Wallet Lock it is paid in kind: the same rate is applied to the native coin and to each asset of the fee asset list recorded when the lock started; the restrictions are lifted only once every fee transfer succeeded.",
          "Before confirming, the exact amounts are computed by the contract itself (previewEarlyUnlock). Fees go to the protocol treasury.",
        ],
      },
      {
        title: "Staking",
        paragraphs: [
          "Staking is optional. When enabled, the locked amount is deposited in the ERC-4626 vault that the protocol whitelisted for that token; the lock holds the vault shares and redeems them when it closes.",
          "The estimated APY is measured from the vault's own on-chain share price over the last days. It is variable and never guaranteed. When no history is available, no estimate is shown.",
          "If no vault is whitelisted for a token on a network, staking is shown as not available — it is never simulated.",
          "Risks: smart-contract risk of the vault, variable or negative returns, withdrawals that can be delayed if the vault lacks liquidity. The early-unlock fee applies to the redeemed value.",
        ],
      },
      {
        title: "Where the data comes from",
        list: [
          "Locks, balances, fee terms and history are read directly from the smart contracts.",
          "Transaction links come from contract events, through the optional indexer or directly from the RPC endpoint.",
          "USD values use Chainlink price feeds when a fresh one exists; otherwise no value is shown.",
          "Nothing is shown as locked before the transaction is confirmed on-chain.",
        ],
      },
      {
        title: "Contracts",
        list: [
          "ProtocolConfig — fee range, duration limits, staking vaults, fee asset lists. Changes only affect new locks.",
          "LockVault — Crypto Locks.",
          "NftLockVault — NFT Locks (ERC-721 and ERC-1155).",
          "LockableAccount — the Lock Account implementation (Wallet Locks).",
          "LockableAccountFactory — deploys Lock Accounts at deterministic addresses.",
        ],
      },
    ],
  },
  fr: {
    title: "Documentation",
    lead: "Fonctionnement des verrouillages, ce que les contrats garantissent, calcul des frais et du staking.",
    sections: [
      {
        title: "Deux façons de verrouiller",
        paragraphs: [
          "Le Crypto Lock verrouille un token précis (ou la monnaie native du réseau) dans le smart contract LockVault jusqu'à la date choisie.",
          "Le Wallet Lock verrouille un Lock Account entier — un smart account appartenant à votre wallet — afin que rien ne puisse en sortir avant la date de déblocage.",
        ],
      },
      {
        title: "Crypto Lock",
        list: [
          "Vous choisissez un token, un montant, une durée et éventuellement le staking, puis vous signez la transaction dans votre wallet.",
          "Les tokens sont transférés vers LockVault, qui enregistre le propriétaire, le token, le montant, la date de début, la date de déblocage et les conditions de frais anticipés.",
          "Chaque verrouillage est indépendant : vous pouvez en avoir autant que vous voulez simultanément.",
          "À partir de la date de déblocage, Unlock at Maturity vous rend tout. Avant, Unlock Early rend le montant diminué des frais de déblocage anticipé.",
          "Personne d'autre — administrateur du protocole compris — ne peut déplacer les fonds verrouillés. La pause du protocole bloque seulement les nouveaux verrouillages ; les retraits restent toujours possibles.",
        ],
      },
      {
        title: "NFT Lock",
        list: [
          "Verrouille un token ERC-721, ou un nombre d'unités d'un token ERC-1155, dans le contrat NftLockVault jusqu'à la date choisie.",
          "ERC-721 : seul le token choisi est autorisé pour le coffre. L'ERC-1155 n'a pas d'autorisation par token : la collection est autorisée pour le coffre, qui ne peut s'en servir que lorsque vous appelez vous-même lock.",
          "Le déblocage anticipé se paie dans la monnaie native du réseau : les frais diminuent linéairement du maximum au minimum, tous deux copiés dans le verrouillage à sa création. Tout montant envoyé au-delà des frais exacts est remboursé dans la même transaction.",
          "Les NFT envoyés directement au coffre sont refusés : rien ne peut y rester bloqué. Le staking n'est pas disponible pour les NFT.",
        ],
      },
      {
        title: "Réseaux et tokens",
        list: [
          "Le réseau principal est Polygon, proposé en premier partout ; Polygon Amoy est son réseau de test.",
          "Les contrats de production n'utilisent pas les opcodes EVM les plus récents : ils fonctionnent sur tout réseau EVM. L'application connaît environ quatre-vingt-dix réseaux ; un réseau devient utilisable dès que le protocole y est déployé, les autres sont affichés comme non déployés.",
          "Les réseaux basés sur zkSync (zkSync Era, Abstract) ne sont pas pris en charge : ils n'exécutent pas le bytecode EVM standard.",
          "Tous les tokens ERC-20 peuvent être verrouillés, sans aucune liste. Les tokens de votre wallet sont détectés automatiquement ; tout autre token peut être ajouté par son adresse de contrat dans le parcours de création (il est mémorisé sur votre appareil). Les tokens sans flux de prix fiable sont affichés sans valeur en dollars.",
          "Les tokens dont les soldes varient d'eux-mêmes fonctionnent normalement : les verrouillages d'un même token partagent une réserve, si bien qu'un rebasage ou une réflexion (stETH, aTokens, tokens à réflexion…) revient à chaque verrouillage au prorata, et les tokens à frais de transfert sont enregistrés pour le montant réellement reçu.",
          "Les cryptos d'autres blockchains (Bitcoin, Solana, XRP…) ne peuvent pas être détenues telles quelles par un contrat EVM : verrouillez leur version émise sur le réseau, comme le WBTC pour le bitcoin ou le SOL Wormhole sur Polygon.",
          "Sur les réseaux où un contrat ERC-20 reflète la monnaie native (POL sur Polygon, CELO sur Celo…), la monnaie native est verrouillée directement et ce reflet est refusé : les deux ne peuvent jamais être confondus.",
        ],
      },
      {
        title: "Wallet Lock",
        paragraphs: [
          "Un wallet protégé par une clé privée (un EOA comme MetaMask) peut toujours signer des transactions. Aucun site ni contrat ne peut l'en empêcher : cette application ne prétend donc jamais geler un tel wallet.",
          "Le Wallet Lock utilise un Lock Account : un smart account minimal appartenant à votre wallet, déployé à une adresse dérivée de celle de votre wallet. Vous y déposez les actifs à protéger. Tant qu'il est verrouillé, le compte lui-même rejette, on-chain :",
        ],
        list: [
          "tout appel sortant : transferts de tokens ou de monnaie, autorisations, interactions avec n'importe quel contrat ;",
          "toute signature : l'ERC-1271 est désactivé en permanence, donc aucun permit, transfert par signature Permit2 ou ordre off-chain ne peut autoriser un transfert ;",
          "les transferts de propriété (la récupération temporisée peut changer le propriétaire, mais ne met jamais fin à un verrouillage).",
        ],
      },
      {
        title: "Autorisations et transferts indirects",
        paragraphs: [
          "Le Lock Account enregistre chaque autorisation qu'il accorde — allowances ERC-20, autorisations ERC-721 et ERC-1155, opérateurs ERC-777, opérateurs et allowances ERC-6909 — y compris celles encapsulées dans un multicall. Après chaque appel, il lit l'état réel on-chain. Un verrouillage ne peut pas commencer tant que l'une d'elles est active : aucun tiers ne peut donc retirer d'actifs pendant le verrouillage. L'application liste les autorisations actives et permet de les révoquer avant de verrouiller.",
          "Limites, dites clairement : les actifs hors du Lock Account ne sont pas verrouillés ; les délégations propres à certains protocoles qui ne sont pas des autorisations de tokens standard, les opérateurs par défaut ERC-777 et les positions qu'un protocole tiers peut liquider échappent à ce que le compte peut contrôler.",
        ],
      },
      {
        title: "Frais de déblocage anticipé",
        paragraphs: [
          "Taux = minimum + (maximum − minimum) × temps restant ÷ durée totale. Il diminue linéairement du maximum (juste après le verrouillage) au minimum (juste avant la date de déblocage), et vaut zéro à l'échéance.",
          "Le minimum et le maximum sont copiés dans chaque verrouillage à sa création et ne peuvent plus jamais changer pour ce verrouillage. Le protocole impose un plafond absolu de 20 %.",
          "Exemple avec les conditions par défaut (1 % à 5 %) : 5 000 USDC verrouillés 90 jours, débloqués à 45 jours de l'échéance → 1 % + 4 % × 45/90 = 3 % → frais de 150 USDC, 4 850 USDC reçus.",
          "Pour un Crypto Lock, les frais sont prélevés dans le token verrouillé. Pour un Wallet Lock, ils sont payés en nature : le même taux s'applique à la monnaie native et à chaque actif de la liste enregistrée au début du verrouillage ; les restrictions ne sont levées qu'une fois tous les transferts de frais réussis.",
          "Avant confirmation, les montants exacts sont calculés par le contrat lui-même (previewEarlyUnlock). Les frais sont envoyés à la trésorerie du protocole.",
        ],
      },
      {
        title: "Staking",
        paragraphs: [
          "Le staking est facultatif. S'il est activé, le montant verrouillé est déposé dans le vault ERC-4626 autorisé par le protocole pour ce token ; le verrouillage détient les parts du vault et les échange à sa clôture.",
          "L'APY estimé est mesuré à partir du prix de part on-chain du vault sur les derniers jours. Il est variable et jamais garanti. Sans historique disponible, aucune estimation n'est affichée.",
          "Si aucun vault n'est autorisé pour un token sur un réseau, le staking est affiché comme indisponible — il n'est jamais simulé.",
          "Risques : risque smart contract du vault, rendement variable voire négatif, retraits pouvant être retardés si le vault manque de liquidité. Les frais anticipés s'appliquent à la valeur récupérée.",
        ],
      },
      {
        title: "Origine des données",
        list: [
          "Verrouillages, soldes, conditions de frais et historique sont lus directement dans les smart contracts.",
          "Les liens de transaction proviennent des événements des contrats, via l'indexeur optionnel ou directement via le point d'accès RPC.",
          "Les valeurs en dollars utilisent les flux de prix Chainlink lorsqu'un prix récent existe ; sinon aucune valeur n'est affichée.",
          "Rien n'est affiché comme verrouillé avant la confirmation on-chain de la transaction.",
        ],
      },
      {
        title: "Contrats",
        list: [
          "ProtocolConfig — plage de frais, limites de durée, vaults de staking, listes d'actifs soumis aux frais. Les changements ne concernent que les nouveaux verrouillages.",
          "LockVault — Crypto Locks.",
          "NftLockVault — NFT Locks (ERC-721 et ERC-1155).",
          "LockableAccount — implémentation du Lock Account (Wallet Locks).",
          "LockableAccountFactory — déploie les Lock Accounts à des adresses déterministes.",
        ],
      },
    ],
  },
};

export const terms: Record<Lang, ProsePage> = {
  en: {
    title: "Terms of use",
    lead: "Draft terms to be reviewed by legal counsel before any production use.",
    sections: [
      {
        title: "Publisher",
        paragraphs: ["CryptoLock, France. Contact: open an issue at github.com/onepixelnft/cryptolock/issues"],
      },
      {
        title: "Non-custodial software",
        paragraphs: [
          "This interface lets you interact with smart contracts deployed on public blockchains. It never holds your private keys and cannot sign transactions on your behalf. Every operation is initiated and signed by you, in your own wallet.",
        ],
      },
      {
        title: "Your commitment",
        list: [
          "A lock is enforced by smart contracts: before its unlock date, your assets can only be recovered through the early unlock, which costs the fee displayed and recorded when you locked.",
          "Transactions on a blockchain are irreversible. Verify every detail before confirming.",
          "Network fees (gas) are paid to the network, not to the protocol, and are never refundable.",
        ],
      },
      {
        title: "Staking and returns",
        paragraphs: [
          "Staking deposits your assets in third-party ERC-4626 vaults. Returns are variable, can be negative and are never guaranteed. Estimated rates are informational only.",
        ],
      },
      {
        title: "No advice",
        paragraphs: [
          "Nothing in this interface is financial, investment, legal or tax advice. You are solely responsible for your decisions and for complying with the laws that apply to you.",
        ],
      },
      {
        title: "Risks and availability",
        list: [
          "Smart contracts can contain undiscovered bugs. Do not lock assets you cannot afford to lose.",
          "The interface may be unavailable at times; the contracts remain usable directly on-chain.",
          "Networks where the protocol is not deployed are displayed as unavailable.",
        ],
      },
    ],
  },
  fr: {
    title: "Conditions d'utilisation",
    lead: "Projet de conditions à faire relire par un juriste avant toute mise en production.",
    sections: [
      {
        title: "Éditeur",
        paragraphs: ["CryptoLock, France. Contact : ouvrez une issue sur github.com/onepixelnft/cryptolock/issues"],
      },
      {
        title: "Logiciel non-custodial",
        paragraphs: [
          "Cette interface vous permet d'interagir avec des smart contracts déployés sur des blockchains publiques. Elle ne détient jamais vos clés privées et ne peut pas signer de transaction à votre place. Chaque opération est initiée et signée par vous, dans votre propre wallet.",
        ],
      },
      {
        title: "Votre engagement",
        list: [
          "Un verrouillage est appliqué par des smart contracts : avant sa date de déblocage, vos actifs ne peuvent être récupérés que par le déblocage anticipé, qui coûte les frais affichés et enregistrés au moment du verrouillage.",
          "Les transactions blockchain sont irréversibles. Vérifiez chaque détail avant de confirmer.",
          "Les frais de réseau (gas) sont payés au réseau, pas au protocole, et ne sont jamais remboursables.",
        ],
      },
      {
        title: "Staking et rendements",
        paragraphs: [
          "Le staking dépose vos actifs dans des vaults ERC-4626 tiers. Les rendements sont variables, peuvent être négatifs et ne sont jamais garantis. Les taux estimés sont fournis à titre indicatif.",
        ],
      },
      {
        title: "Absence de conseil",
        paragraphs: [
          "Rien dans cette interface ne constitue un conseil financier, d'investissement, juridique ou fiscal. Vous êtes seul responsable de vos décisions et du respect des lois qui vous sont applicables.",
        ],
      },
      {
        title: "Risques et disponibilité",
        list: [
          "Les smart contracts peuvent contenir des failles non découvertes. Ne verrouillez pas d'actifs que vous ne pouvez pas vous permettre de perdre.",
          "L'interface peut être momentanément indisponible ; les contrats restent utilisables directement on-chain.",
          "Les réseaux où le protocole n'est pas déployé sont affichés comme indisponibles.",
        ],
      },
    ],
  },
};

export const security: Record<Lang, ProsePage> = {
  en: {
    title: "Security",
    lead: "What protects your assets, what the contracts guarantee, and the current audit status.",
    sections: [
      {
        title: "Your keys",
        list: [
          "The app connects to external wallets (browser wallets, WalletConnect). Your private keys never leave your wallet.",
          "The app never asks for — and never stores — your recovery phrase or private keys. Anyone asking for them is trying to steal your funds.",
          "Every transaction is simulated against the contract before being sent to your wallet for signature.",
        ],
      },
      {
        title: "Guarantees enforced by the contracts",
        list: [
          "No administrator function can move locked funds.",
          "Fee terms, staking vault and fee asset list are fixed per lock at creation; protocol changes only affect new locks.",
          "Hard limits written in the code: early-unlock fee ≤ 20%, lock duration ≤ 20 years.",
          "Pausing only blocks new locks — withdrawals and early unlocks always remain possible.",
          "Each lock can be closed only once: its status changes before any transfer, and every entry point is protected against reentrancy.",
          "Token amounts are measured on receipt (fee-on-transfer tokens) and transfers use SafeERC20.",
          "The locks of a token hold shares of a common pool, so tokens whose balances change on their own are shared fairly and the last lock out is never short. Virtual shares make an attempt to dilute a new pool by donating tokens cost its author far more than it could take.",
          "Fees are collected by the contracts themselves and sent to the treasury; displayed fees are computed by the contracts.",
          "The transaction that creates a lock carries the terms you reviewed (staking vault, fee range and, for a Wallet Lock, the fee asset list). If the administrator changed them in the meantime, the contract refuses it and nothing is locked; the app then shows the new terms for you to accept again.",
          "If a staking vault cannot pay out at maturity (paused, withdrawal limit, missing liquidity), you can take the vault shares themselves, without fee, and redeem them later with the vault.",
          "Production bytecode is checked by an automated test to contain no opcode newer than the Paris fork, so it behaves the same on every EVM network.",
        ],
      },
      {
        title: "Website protections",
        list: [
          "A Content-Security-Policy only allows scripts served by the site itself: no third-party script, no plugin, and the site cannot be embedded in another page.",
          "Contracts deployed with an older interface version are never used: the network is shown as needing a redeployment instead.",
          "Token detection downloads public token lists only (CoinGecko, Uniswap, Superchain), at most once a day: your address is never sent to them, and the balances, names and decimals shown are read from the blockchain. Detection can be turned off in the settings.",
        ],
      },
      {
        title: "Wallet Lock enforcement",
        list: [
          "The Lock Account has no delegatecall, no modules and no upgrade path: its outgoing paths are execute, executeBatch and unlockEarly, all checked against the lock.",
          "ERC-1271 signatures are always rejected, so off-chain authorisations cannot bypass the lock.",
          "A lock cannot start while an approval granted by the account is live.",
          "Recovery requires a delay of 2 to 90 days, can be cancelled by the owner, and never ends a lock.",
        ],
      },
      {
        title: "Audit status",
        paragraphs: [
          "The contracts come with an automated test suite covering locking, maturity, early unlock fees, staking, pausing, reentrancy, approvals tracking and recovery. They have NOT yet been audited by an independent firm. Until an audit is completed and published, use test networks (Polygon Amoy), and on a main network — Polygon included — only lock amounts you can afford to lose.",
        ],
      },
      {
        title: "Reporting a vulnerability",
        paragraphs: [
          "Please report any suspected vulnerability privately to the GitHub repository (Security tab), with enough detail to reproduce it, before any public disclosure.",
        ],
      },
    ],
  },
  fr: {
    title: "Sécurité",
    lead: "Ce qui protège vos actifs, ce que les contrats garantissent, et l'état de l'audit.",
    sections: [
      {
        title: "Vos clés",
        list: [
          "L'application se connecte à des wallets externes (wallets de navigateur, WalletConnect). Vos clés privées ne quittent jamais votre wallet.",
          "L'application ne demande jamais — et ne stocke jamais — votre phrase de récupération ni vos clés privées. Quiconque vous les demande cherche à voler vos fonds.",
          "Chaque transaction est simulée sur le contrat avant d'être envoyée à votre wallet pour signature.",
        ],
      },
      {
        title: "Garanties appliquées par les contrats",
        list: [
          "Aucune fonction d'administration ne peut déplacer des fonds verrouillés.",
          "Conditions de frais, vault de staking et liste d'actifs soumis aux frais sont figés pour chaque verrouillage à sa création ; les changements du protocole ne concernent que les nouveaux verrouillages.",
          "Limites absolues inscrites dans le code : frais anticipés ≤ 20 %, durée ≤ 20 ans.",
          "La pause bloque uniquement les nouveaux verrouillages — retraits et déblocages anticipés restent toujours possibles.",
          "Chaque verrouillage ne peut être clôturé qu'une fois : son statut change avant tout transfert, et chaque point d'entrée est protégé contre la réentrance.",
          "Les montants de tokens sont mesurés à la réception (tokens à frais de transfert) et les transferts utilisent SafeERC20.",
          "Les verrouillages d'un même token détiennent des parts d'une réserve commune : les tokens dont les soldes varient d'eux-mêmes sont répartis équitablement et le dernier verrouillage à sortir n'est jamais à court. Des parts virtuelles font qu'une tentative de diluer une nouvelle réserve en y donnant des tokens coûte à son auteur bien plus qu'elle ne pourrait prendre.",
          "Les frais sont prélevés par les contrats eux-mêmes et envoyés à la trésorerie ; les frais affichés sont calculés par les contrats.",
          "La transaction qui crée un verrouillage contient les conditions que vous avez vérifiées (vault de staking, plage de frais et, pour un Wallet Lock, la liste d'actifs facturés). Si l'administrateur les a changées entre-temps, le contrat la refuse et rien n'est verrouillé ; l'application affiche alors les nouvelles conditions, à accepter de nouveau.",
          "Si un vault de staking ne peut pas rembourser à l'échéance (en pause, limite de retrait, liquidité insuffisante), vous pouvez recevoir directement les parts du vault, sans frais, et les échanger plus tard auprès du vault.",
          "Un test automatique vérifie que le bytecode de production ne contient aucun opcode postérieur au fork Paris : il se comporte de la même façon sur tous les réseaux EVM.",
        ],
      },
      {
        title: "Protections du site",
        list: [
          "Une Content-Security-Policy n'autorise que les scripts servis par le site lui-même : aucun script tiers, aucun plugin, et le site ne peut pas être intégré dans une autre page.",
          "Des contrats déployés avec une ancienne version d'interface ne sont jamais utilisés : le réseau est affiché comme devant être redéployé.",
          "La détection des tokens télécharge uniquement des listes publiques (CoinGecko, Uniswap, Superchain), au plus une fois par jour : votre adresse ne leur est jamais envoyée, et les soldes, noms et décimales affichés sont lus sur la blockchain. Elle peut être désactivée dans les paramètres.",
        ],
      },
      {
        title: "Application du Wallet Lock",
        list: [
          "Le Lock Account n'a ni delegatecall, ni modules, ni mécanisme de mise à jour : ses chemins sortants sont execute, executeBatch et unlockEarly, tous contrôlés par le verrouillage.",
          "Les signatures ERC-1271 sont toujours rejetées : aucune autorisation off-chain ne peut contourner le verrouillage.",
          "Un verrouillage ne peut pas commencer tant qu'une autorisation accordée par le compte est active.",
          "La récupération exige un délai de 2 à 90 jours, peut être annulée par le propriétaire et ne met jamais fin à un verrouillage.",
        ],
      },
      {
        title: "État de l'audit",
        paragraphs: [
          "Les contrats sont accompagnés d'une suite de tests automatisés couvrant verrouillage, échéance, frais anticipés, staking, pause, réentrance, suivi des autorisations et récupération. Ils n'ont PAS encore été audités par un cabinet indépendant. Tant qu'un audit n'est pas réalisé et publié, utilisez les réseaux de test (Polygon Amoy) et, sur un réseau principal — Polygon compris —, ne verrouillez que des montants que vous pouvez vous permettre de perdre.",
        ],
      },
      {
        title: "Signaler une vulnérabilité",
        paragraphs: [
          "Signalez toute vulnérabilité suspectée en privé à the GitHub repository (Security tab), avec assez de détails pour la reproduire, avant toute divulgation publique.",
        ],
      },
    ],
  },
};
