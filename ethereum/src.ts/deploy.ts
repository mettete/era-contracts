import * as hardhat from 'hardhat';
import '@nomiclabs/hardhat-ethers';
import '@openzeppelin/hardhat-upgrades';

import { BigNumberish, ethers, providers, Signer, Wallet } from 'ethers';
import { Interface } from 'ethers/lib/utils';
import { diamondCut, FacetCut } from './diamondCut';
import { IBridgeheadFactory } from '../typechain/IBridgeheadFactory';
import { IProofSystemFactory } from '../typechain/IProofSystemFactory';
import { IProofChainFactory } from '../typechain/IProofChainFactory';
import { getCurrentFacetCutsForAdd } from './diamondCut';
import { L1ERC20BridgeFactory } from '../typechain/L1ERC20BridgeFactory';
import { L1WethBridgeFactory } from '../typechain/L1WethBridgeFactory';
import { ValidatorTimelockFactory } from '../typechain/ValidatorTimelockFactory';
import { SingletonFactoryFactory } from '../typechain/SingletonFactoryFactory';
import { AllowListFactory } from '../typechain';
import { hexlify } from 'ethers/lib/utils';
import {
    readSystemContractsBytecode,
    hashL2Bytecode,
    getAddressFromEnv,
    getHashFromEnv,
    getNumberFromEnv,
    readBlockBootloaderBytecode,
    getTokens
} from '../scripts/utils';
import { deployViaCreate2 } from './deploy-utils';

const L2_BOOTLOADER_BYTECODE_HASH = hexlify(hashL2Bytecode(readBlockBootloaderBytecode()));
const L2_DEFAULT_ACCOUNT_BYTECODE_HASH = hexlify(hashL2Bytecode(readSystemContractsBytecode('DefaultAccount')));

export interface DeployedAddresses {
    Bridgehead: {
        BridgeheadProxy: string;
        BridgeheadImplementation: string;
        BridgeheadProxyAdmin: string;
        ChainImplementation: string;
        ChainProxy: string;
        ChainProxyAdmin: string;
    };
    ProofSystem: {
        ProofSystemProxy: string;
        ProofSystemImplementation: string;
        ProofSystemProxyAdmin: string;
        Verifier: string;
        GovernanceFacet: string;
        ExecutorFacet: string;
        DiamondCutFacet: string;
        GettersFacet: string;
        DiamondInit: string;
        DiamondUpgradeInit: string;
        DefaultUpgrade: string;
        DiamondProxy: string;
    };
    Bridges: {
        ERC20BridgeImplementation: string;
        ERC20BridgeProxy: string;
        WethBridgeImplementation: string;
        WethBridgeProxy: string;
    };
    AllowList: string;
    ValidatorTimeLock: string;
    Create2Factory: string;
}

export interface DeployerConfig {
    deployWallet: Wallet;
    governorAddress?: string;
    verbose?: boolean;
}

export function deployedAddressesFromEnv(): DeployedAddresses {
    return {
        Bridgehead: {
            BridgeheadProxy: getAddressFromEnv('CONTRACTS_BRIDGEHEAD_PROXY_ADDR'),
            BridgeheadImplementation: getAddressFromEnv('CONTRACTS_BRIDGEHEAD_IMPL_ADDR'),
            BridgeheadProxyAdmin: getAddressFromEnv('CONTRACTS_BRIDGEHEAD_PROXY_ADMIN_ADDR'),
            ChainImplementation: getAddressFromEnv('CONTRACTS_BRIDGEHEAD_CHAIN_IMPL_ADDR'),
            ChainProxy: getAddressFromEnv('CONTRACTS_BRIDGEHEAD_CHAIN_PROXY_ADDR'),
            ChainProxyAdmin: getAddressFromEnv('CONTRACTS_BRIDGEHEAD_CHAIN_PROXY_ADMIN_ADDR')
        },
        ProofSystem: {
            ProofSystemProxy: getAddressFromEnv('CONTRACTS_PROOF_SYSTEM_PROXY_ADDR'),
            ProofSystemImplementation: getAddressFromEnv('CONTRACTS_PROOF_SYSTEM_IMPL_ADDR'),
            ProofSystemProxyAdmin: getAddressFromEnv('CONTRACTS_PROOF_SYSTEM_PROXY_ADMIN_ADDR'),
            Verifier: getAddressFromEnv('CONTRACTS_VERIFIER_ADDR'),
            GovernanceFacet: getAddressFromEnv('CONTRACTS_GOVERNANCE_FACET_ADDR'),
            DiamondCutFacet: getAddressFromEnv('CONTRACTS_DIAMOND_CUT_FACET_ADDR'),
            ExecutorFacet: getAddressFromEnv('CONTRACTS_EXECUTOR_FACET_ADDR'),
            GettersFacet: getAddressFromEnv('CONTRACTS_GETTERS_FACET_ADDR'),
            DiamondInit: getAddressFromEnv('CONTRACTS_DIAMOND_INIT_ADDR'),
            DiamondUpgradeInit: getAddressFromEnv('CONTRACTS_DIAMOND_UPGRADE_INIT_ADDR'),
            DefaultUpgrade: getAddressFromEnv('CONTRACTS_DEFAULT_UPGRADE_ADDR'),
            DiamondProxy: getAddressFromEnv('CONTRACTS_DIAMOND_PROXY_ADDR')
        },
        Bridges: {
            ERC20BridgeImplementation: getAddressFromEnv('CONTRACTS_L1_ERC20_BRIDGE_IMPL_ADDR'),
            ERC20BridgeProxy: getAddressFromEnv('CONTRACTS_L1_ERC20_BRIDGE_PROXY_ADDR'),
            WethBridgeImplementation: getAddressFromEnv('CONTRACTS_L1_WETH_BRIDGE_IMPL_ADDR'),
            WethBridgeProxy: getAddressFromEnv('CONTRACTS_L1_WETH_BRIDGE_PROXY_ADDR')
        },
        AllowList: getAddressFromEnv('CONTRACTS_L1_ALLOW_LIST_ADDR'),
        Create2Factory: getAddressFromEnv('CONTRACTS_CREATE2_FACTORY_ADDR'),
        ValidatorTimeLock: getAddressFromEnv('CONTRACTS_VALIDATOR_TIMELOCK_ADDR')
    };
}

export class Deployer {
    public addresses: DeployedAddresses;
    private deployWallet: Wallet;
    private verbose: boolean;
    private governorAddress: string;

    constructor(config: DeployerConfig) {
        this.deployWallet = config.deployWallet;
        this.verbose = config.verbose != null ? config.verbose : false;
        this.addresses = deployedAddressesFromEnv();
        this.governorAddress = config.governorAddress != null ? config.governorAddress : this.deployWallet.address;
    }

    public async initialProofSystemProxyDiamondCut() {
        const facetCuts: FacetCut[] = Object.values(
            await getCurrentFacetCutsForAdd(
                this.addresses.ProofSystem.DiamondCutFacet,
                this.addresses.ProofSystem.GettersFacet,
                this.addresses.ProofSystem.ExecutorFacet,
                this.addresses.ProofSystem.GovernanceFacet
            )
        );

        // const genesisBlockHash = getHashFromEnv('CONTRACTS_GENESIS_ROOT'); // TODO: confusing name
        // const genesisRollupLeafIndex = getNumberFromEnv('CONTRACTS_GENESIS_ROLLUP_LEAF_INDEX');
        // const genesisBlockCommitment = getHashFromEnv('CONTRACTS_GENESIS_BLOCK_COMMITMENT');
        const verifierParams = {
            recursionNodeLevelVkHash: getHashFromEnv('CONTRACTS_RECURSION_NODE_LEVEL_VK_HASH'),
            recursionLeafLevelVkHash: getHashFromEnv('CONTRACTS_RECURSION_LEAF_LEVEL_VK_HASH'),
            recursionCircuitsSetVksHash: getHashFromEnv('CONTRACTS_RECURSION_CIRCUITS_SET_VKS_HASH')
        };
        const priorityTxMaxGasLimit = getNumberFromEnv('CONTRACTS_PRIORITY_TX_MAX_GAS_LIMIT');
        const DiamondInit = new Interface(hardhat.artifacts.readArtifactSync('DiamondInit').abi);

        const diamondInitCalldata = DiamondInit.encodeFunctionData('initialize', [
            // these are set in the contract
            '0x0000000000000000000000000000000000001234',
            '0x0000000000000000000000000000000000002234',
            '0x0000000000000000000000000000000000003234',
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            this.addresses.AllowList,
            this.addresses.ProofSystem.Verifier,
            verifierParams,
            L2_BOOTLOADER_BYTECODE_HASH,
            L2_DEFAULT_ACCOUNT_BYTECODE_HASH,
            priorityTxMaxGasLimit
        ]);

        return diamondCut(facetCuts, this.addresses.ProofSystem.DiamondInit, diamondInitCalldata);
    }

    public async deployCreate2Factory(ethTxOptions?: ethers.providers.TransactionRequest) {
        if (this.verbose) {
            console.log('Deploying Create2 factory');
        }

        const contractFactory = await hardhat.ethers.getContractFactory('SingletonFactory', {
            signer: this.deployWallet
        });

        const create2Factory = await contractFactory.deploy(...[ethTxOptions]);
        const rec = await create2Factory.deployTransaction.wait();

        if (this.verbose) {
            console.log(`CONTRACTS_CREATE2_FACTORY_ADDR=${create2Factory.address}`);
            console.log(`Create2 factory deployed, gasUsed: ${rec.gasUsed.toString()}`);
        }

        this.addresses.Create2Factory = create2Factory.address;
    }

    private async deployViaCreate2(
        contractName: string,
        args: any[],
        create2Salt: string,
        ethTxOptions: ethers.providers.TransactionRequest,
        libraries?: any
    ) {
        let result = await deployViaCreate2(
            this.deployWallet,
            contractName,
            args,
            create2Salt,
            ethTxOptions,
            this.addresses.Create2Factory,
            this.verbose,
            libraries
        );
        return result[0];
    }

    public async deployAllowList(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2(
            'AllowList',
            [this.governorAddress],
            create2Salt,
            ethTxOptions
        );

        if (this.verbose) {
            console.log(`CONTRACTS_L1_ALLOW_LIST_ADDR=${contractAddress}`);
        }

        this.addresses.AllowList = contractAddress;
    }

    public async deployBridgeheadChainProxy(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        // we deploy a whole chainProxy, but we only store the admin and implementation addresses
        ethTxOptions.gasLimit ??= 10_000_000;

        const Chain = await hardhat.ethers.getContractFactory('BridgeheadChain');
        const addressOne = '0x0000000000000000000000000000000000000001';
        const instance: ethers.Contract = await hardhat.upgrades.deployProxy(Chain, [
            0,
            hardhat.ethers.constants.AddressZero,
            addressOne,
            this.addresses.AllowList,
            0
        ]);

        await instance.deployed();

        const adminAddress = await hardhat.upgrades.erc1967.getAdminAddress(instance.address);

        const implAddress = await hardhat.upgrades.erc1967.getImplementationAddress(instance.address);

        if (this.verbose) {
            console.log(`CONTRACTS_BRIDGEHEAD_CHAIN_IMPL_ADDR=${implAddress}`);
        }

        this.addresses.Bridgehead.ChainImplementation = implAddress;

        if (this.verbose) {
            console.log(`CONTRACTS_BRIDGEHEAD_CHAIN_PROXY_ADMIN_ADDR=${adminAddress}`);
        }

        console.log(
            `Bridgehead Chain Proxy deployed, gas used: ${(await instance.deployTransaction.wait()).gasUsed.toString()}`
        );

        this.addresses.Bridgehead.ChainProxyAdmin = adminAddress;
    }

    public async deployBridgeheadProxy(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;

        const Bridgehead = await hardhat.ethers.getContractFactory('Bridgehead');
        const instance = await hardhat.upgrades.deployProxy(Bridgehead, [
            this.governorAddress,
            this.addresses.Bridgehead.ChainImplementation,
            this.addresses.Bridgehead.ChainProxyAdmin,
            this.addresses.AllowList,
            process.env.CONTRACTS_PRIORITY_TX_MAX_GAS_LIMIT
        ]);
        await instance.deployed();

        const implAddress = await hardhat.upgrades.erc1967.getImplementationAddress(instance.address);
        const adminAddress = await hardhat.upgrades.erc1967.getAdminAddress(instance.address);

        if (this.verbose) {
            console.log(`CONTRACTS_BRIDGEHEAD_IMPL_ADDR=${implAddress}`);
        }

        this.addresses.Bridgehead.BridgeheadImplementation = implAddress;

        if (this.verbose) {
            console.log(`CONTRACTS_BRIDGEHEAD_PROXY_ADDR=${instance.address}`);
        }

        this.addresses.Bridgehead.BridgeheadProxy = instance.address;

        if (this.verbose) {
            console.log(`CONTRACTS_BRIDGEHEAD_PROXY_ADMIN_ADDR=${adminAddress}`);
        }

        console.log(
            `Bridgehead Proxy deployed, gas used: ${(await instance.deployTransaction.wait()).gasUsed.toString()}`
        );

        this.addresses.Bridgehead.BridgeheadProxyAdmin = adminAddress;
    }

    public async deployProofSystemProxy(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;

        const ProofSystem = await hardhat.ethers.getContractFactory('ProofSystem');

        const genesisBlockHash = getHashFromEnv('CONTRACTS_GENESIS_ROOT'); // TODO: confusing name
        const genesisRollupLeafIndex = getNumberFromEnv('CONTRACTS_GENESIS_ROLLUP_LEAF_INDEX');
        const genesisBlockCommitment = getHashFromEnv('CONTRACTS_GENESIS_BLOCK_COMMITMENT');
        const priorityTxMaxGasLimit = getNumberFromEnv('CONTRACTS_PRIORITY_TX_MAX_GAS_LIMIT');

        const instance = await hardhat.upgrades.deployProxy(ProofSystem, [
            this.addresses.Bridgehead.BridgeheadProxy,
            this.addresses.ProofSystem.Verifier,
            this.governorAddress,
            genesisBlockHash,
            genesisRollupLeafIndex,
            genesisBlockCommitment,
            this.addresses.AllowList,
            L2_BOOTLOADER_BYTECODE_HASH,
            L2_DEFAULT_ACCOUNT_BYTECODE_HASH,
            priorityTxMaxGasLimit
        ]);
        await instance.deployed();

        const implAddress = await hardhat.upgrades.erc1967.getImplementationAddress(instance.address);
        const adminAddress = await hardhat.upgrades.erc1967.getAdminAddress(instance.address);

        if (this.verbose) {
            console.log(`CONTRACTS_PROOF_SYSTEM_IMPL_ADDR=${implAddress}`);
        }

        this.addresses.ProofSystem.ProofSystemImplementation = implAddress;

        if (this.verbose) {
            console.log(`CONTRACTS_PROOF_SYSTEM_PROXY_ADDR=${instance.address}`);
        }

        this.addresses.ProofSystem.ProofSystemProxy = instance.address;

        if (this.verbose) {
            console.log(`CONTRACTS_PROOF_SYSTEM_PROXY_ADMIN_ADDR=${adminAddress}`);
        }

        console.log(
            `ProofSystem Proxy deployed, gas used: ${(await instance.deployTransaction.wait()).gasUsed.toString()}`
        );

        this.addresses.ProofSystem.ProofSystemProxyAdmin = adminAddress;
    }

    public async deployProofGovernanceFacet(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2('GovernanceFacet', [], create2Salt, ethTxOptions);

        if (this.verbose) {
            console.log(`CONTRACTS_GOVERNANCE_FACET_ADDR=${contractAddress}`);
        }

        this.addresses.ProofSystem.GovernanceFacet = contractAddress;
    }

    public async deployProofDiamondCutFacet(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2('DiamondCutFacet', [], create2Salt, ethTxOptions);

        if (this.verbose) {
            console.log(`CONTRACTS_DIAMOND_CUT_FACET_ADDR=${contractAddress}`);
        }

        this.addresses.ProofSystem.DiamondCutFacet = contractAddress;
    }

    public async deployProofExecutorFacet(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2('ExecutorFacet', [], create2Salt, ethTxOptions);

        if (this.verbose) {
            console.log(`CONTRACTS_EXECUTOR_FACET_ADDR=${contractAddress}`);
        }

        this.addresses.ProofSystem.ExecutorFacet = contractAddress;
    }

    public async deployProofGettersFacet(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2('GettersFacet', [], create2Salt, ethTxOptions);

        if (this.verbose) {
            console.log(`CONTRACTS_GETTERS_FACET_ADDR=${contractAddress}`);
        }

        this.addresses.ProofSystem.GettersFacet = contractAddress;
    }

    public async deployVerifier(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2('Verifier', [], create2Salt, ethTxOptions);

        if (this.verbose) {
            console.log(`CONTRACTS_VERIFIER_ADDR=${contractAddress}`);
        }

        this.addresses.ProofSystem.Verifier = contractAddress;
    }

    public async deployERC20BridgeImplementation(
        create2Salt: string,
        ethTxOptions: ethers.providers.TransactionRequest
    ) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2(
            'L1ERC20Bridge',
            [this.addresses.Bridgehead.BridgeheadProxy, this.addresses.AllowList],
            create2Salt,
            ethTxOptions
        );

        if (this.verbose) {
            console.log(`CONTRACTS_L1_ERC20_BRIDGE_IMPL_ADDR=${contractAddress}`);
        }

        this.addresses.Bridges.ERC20BridgeImplementation = contractAddress;
    }

    public async deployERC20BridgeProxy(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2(
            'TransparentUpgradeableProxy',
            [this.addresses.Bridges.ERC20BridgeImplementation, this.governorAddress, '0x'],
            create2Salt,
            ethTxOptions
        );

        if (this.verbose) {
            console.log(`CONTRACTS_L1_ERC20_BRIDGE_PROXY_ADDR=${contractAddress}`);
        }

        this.addresses.Bridges.ERC20BridgeProxy = contractAddress;
    }

    public async deployWethToken(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2('WETH9', [], create2Salt, ethTxOptions);

        if (this.verbose) {
            console.log(`CONTRACTS_L1_WETH_TOKEN_ADDR=${contractAddress}`);
        }
    }

    public async deployWethBridgeImplementation(
        create2Salt: string,
        ethTxOptions: ethers.providers.TransactionRequest
    ) {
        const tokens = getTokens(process.env.CHAIN_ETH_NETWORK || 'localhost');
        const l1WethToken = tokens.find((token: { symbol: string }) => token.symbol == 'WETH')!.address;

        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2(
            'L1WethBridge',
            [l1WethToken, this.addresses.Bridgehead.BridgeheadProxy, this.addresses.AllowList],
            create2Salt,
            ethTxOptions
        );

        if (this.verbose) {
            console.log(`CONTRACTS_L1_WETH_BRIDGE_IMPL_ADDR=${contractAddress}`);
        }

        this.addresses.Bridges.WethBridgeImplementation = contractAddress;
    }

    public async deployWethBridgeProxy(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2(
            'TransparentUpgradeableProxy',
            [this.addresses.Bridges.WethBridgeImplementation, this.governorAddress, '0x'],
            create2Salt,
            ethTxOptions
        );

        if (this.verbose) {
            console.log(`CONTRACTS_L1_WETH_BRIDGE_PROXY_ADDR=${contractAddress}`);
        }

        this.addresses.Bridges.WethBridgeProxy = contractAddress;
    }

    public async deployProofDiamondInit(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2('DiamondInit', [], create2Salt, ethTxOptions);

        if (this.verbose) {
            console.log(`CONTRACTS_DIAMOND_INIT_ADDR=${contractAddress}`);
        }

        this.addresses.ProofSystem.DiamondInit = contractAddress;
    }

    public async deployDiamondUpgradeInit(
        create2Salt: string,
        contractVersion: number,
        ethTxOptions: ethers.providers.TransactionRequest
    ) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2(
            `DiamondUpgradeInit${contractVersion}`,
            [],
            create2Salt,
            ethTxOptions
        );

        if (this.verbose) {
            console.log(`CONTRACTS_DIAMOND_UPGRADE_INIT_ADDR=${contractAddress}`);
        }

        this.addresses.ProofSystem.DiamondUpgradeInit = contractAddress;
    }

    public async deployDefaultUpgrade(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2('ProofDefaultUpgrade', [], create2Salt, ethTxOptions);

        if (this.verbose) {
            console.log(`CONTRACTS_DEFAULT_UPGRADE_ADDR=${contractAddress}`);
        }

        this.addresses.ProofSystem.DefaultUpgrade = contractAddress;
    }

    public async deployBridgeheadContract(create2Salt: string, gasPrice?: BigNumberish, nonce?) {
        nonce = nonce ? parseInt(nonce) : await this.deployWallet.getTransactionCount();

        // deploy Bridgehead contract
        // await this.deployChainImplementation(create2Salt, { gasPrice, nonce: nonce });
        await this.deployBridgeheadChainProxy(create2Salt, { gasPrice, nonce: nonce + 0 });
        // await this.deployBridgeheadImplementation(create2Salt, { gasPrice, nonce: nonce + 2 });
        // await this.deployBridgeheadProxyAdmin(create2Salt, { gasPrice, nonce: nonce + 3 });
        await this.deployBridgeheadProxy(create2Salt, { gasPrice, nonce: nonce + 1 });
    }

    public async deployProofSystemContract(create2Salt: string, gasPrice?: BigNumberish, nonce?) {
        nonce = nonce ? parseInt(nonce) : await this.deployWallet.getTransactionCount();

        // deploy Bridgehead contract
        // await this.deployVerifier(create2Salt, { gasPrice, nonce: nonce + 1 });
        // await this.deployChainImplementation(create2Salt, { gasPrice, nonce: nonce });
        await this.deployProofDiamond(create2Salt, gasPrice, nonce);
        // await this.deployBridgeheadImplementation(create2Salt, { gasPrice, nonce: nonce + 2 });
        // await this.deployBridgeheadProxyAdmin(create2Salt, { gasPrice, nonce: nonce + 3 });
        await this.deployProofSystemProxy(create2Salt, { gasPrice, nonce: nonce + 1 });
        await this.registerProofSystem();
    }

    public async deployProofDiamond(create2Salt: string, gasPrice?: BigNumberish, nonce?) {
        nonce = nonce ? parseInt(nonce) : await this.deployWallet.getTransactionCount();

        // deploy Factory contract
        const independentProofSystemDeployPromises = [
            this.deployProofExecutorFacet(create2Salt, { gasPrice, nonce: nonce }),
            this.deployProofDiamondCutFacet(create2Salt, { gasPrice, nonce: nonce + 1 }),
            this.deployProofGovernanceFacet(create2Salt, { gasPrice, nonce: nonce + 2 }),
            this.deployProofGettersFacet(create2Salt, { gasPrice, nonce: nonce + 3 }),
            this.deployVerifier(create2Salt, { gasPrice, nonce: nonce + 4 }),
            this.deployProofDiamondInit(create2Salt, { gasPrice, nonce: nonce + 5 })
        ];
        await Promise.all(independentProofSystemDeployPromises);
        nonce += 6;
    }

    public async registerProofSystem() {
        // const gasLimit = 10_000_000;

        // nonce = nonce ? parseInt(nonce) : await this.deployWallet.getTransactionCount();
        const bridgehead = this.bridgeheadContract(this.deployWallet);

        const tx = await bridgehead.newProofSystem(
            this.addresses.ProofSystem.ProofSystemProxy
            //      {
            //     gasPrice,
            //     nonce,
            //     gasLimit
            // }
        );

        const receipt = await tx.wait();
        console.log(`Proof System registered, gas used: ${receipt.gasUsed.toString()}`);
        // KL todo: ChainId is not a uint256 yet.
    }

    public async registerHyperchain(create2Salt: string, gasPrice?: BigNumberish, nonce?) {
        const gasLimit = 10_000_000;

        nonce = nonce ? parseInt(nonce) : await this.deployWallet.getTransactionCount();

        const bridgehead = this.bridgeheadContract(this.deployWallet);
        const proofSystem = this.proofSystemContract(this.deployWallet);

        // const inputChainId = getNumberFromEnv("CHAIN_ETH_ZKSYNC_NETWORK_ID");
        const inputChainId = 0;
        const governor = this.governorAddress;
        const allowList = this.addresses.AllowList;
        const initialDiamondCut = await this.initialProofSystemProxyDiamondCut();

        const tx = await bridgehead.newChain(
            inputChainId,
            this.addresses.ProofSystem.ProofSystemProxy,
            governor,
            allowList,
            initialDiamondCut,
            { gasPrice, nonce, gasLimit }
        );
        const receipt = await tx.wait();
        const chainId = receipt.logs.find((log) => log.topics[0] == bridgehead.interface.getEventTopic('NewChain'))
            .topics[1];

        const contractAddress =
            '0x' +
            receipt.logs
                .find((log) => log.topics[0] == bridgehead.interface.getEventTopic('NewChain'))
                .topics[2].slice(26);

        const proofContractAddress =
            '0x' +
            receipt.logs
                .find((log) => log.topics[0] == proofSystem.interface.getEventTopic('NewProofChain'))
                .topics[2].slice(26);

        this.addresses.Bridgehead.ChainProxy = contractAddress;
        this.addresses.ProofSystem.DiamondProxy = proofContractAddress;

        console.log(`Hyperchain registered, gas used: ${receipt.gasUsed.toString()}`);
        // KL todo: ChainId is not a uint256 yet.
        console.log(`CHAIN_ETH_ZKSYNC_NETWORK_ID=${parseInt(chainId, 16)}`);
        console.log(`CONTRACTS_BRIDGEHEAD_CHAIN_PROXY_ADDR=${contractAddress}`);
        console.log(`CONTRACTS_DIAMOND_PROXY_ADDR=${proofContractAddress}`);
    }

    public async deployBridgeContracts(create2Salt: string, gasPrice?: BigNumberish, nonce?) {
        nonce = nonce ? parseInt(nonce) : await this.deployWallet.getTransactionCount();

        await this.deployERC20BridgeImplementation(create2Salt, { gasPrice, nonce: nonce });
        await this.deployERC20BridgeProxy(create2Salt, { gasPrice, nonce: nonce + 1 });
    }

    public async deployWethBridgeContracts(create2Salt: string, gasPrice?: BigNumberish, nonce?) {
        nonce = nonce ? parseInt(nonce) : await this.deployWallet.getTransactionCount();

        await this.deployWethBridgeImplementation(create2Salt, { gasPrice, nonce: nonce++ });
        await this.deployWethBridgeProxy(create2Salt, { gasPrice, nonce: nonce++ });
    }

    public async deployValidatorTimelock(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const executionDelay = getNumberFromEnv('CONTRACTS_VALIDATOR_TIMELOCK_EXECUTION_DELAY');
        const validatorAddress = getAddressFromEnv('ETH_SENDER_SENDER_OPERATOR_COMMIT_ETH_ADDR');
        const contractAddress = await this.deployViaCreate2(
            'ValidatorTimelock',
            [this.governorAddress, this.addresses.ProofSystem.DiamondProxy, executionDelay, validatorAddress],
            create2Salt,
            ethTxOptions
        );

        if (this.verbose) {
            console.log(`CONTRACTS_VALIDATOR_TIMELOCK_ADDR=${contractAddress}`);
        }

        this.addresses.ValidatorTimeLock = contractAddress;
    }

    public async deployMulticall3(create2Salt: string, ethTxOptions: ethers.providers.TransactionRequest) {
        ethTxOptions.gasLimit ??= 10_000_000;
        const contractAddress = await this.deployViaCreate2('Multicall3', [], create2Salt, ethTxOptions);

        if (this.verbose) {
            console.log(`CONTRACTS_L1_MULTICALL3_ADDR=${contractAddress}`);
        }
    }

    public create2FactoryContract(signerOrProvider: Signer | providers.Provider) {
        return SingletonFactoryFactory.connect(this.addresses.Create2Factory, signerOrProvider);
    }

    public bridgeheadContract(signerOrProvider: Signer | providers.Provider) {
        return IBridgeheadFactory.connect(this.addresses.Bridgehead.BridgeheadProxy, signerOrProvider);
    }

    public proofSystemContract(signerOrProvider: Signer | providers.Provider) {
        return IProofSystemFactory.connect(this.addresses.ProofSystem.ProofSystemProxy, signerOrProvider);
    }

    public proofChainContract(signerOrProvider: Signer | providers.Provider) {
        return IProofChainFactory.connect(this.addresses.ProofSystem.DiamondProxy, signerOrProvider);
    }

    public validatorTimelock(signerOrProvider: Signer | providers.Provider) {
        return ValidatorTimelockFactory.connect(this.addresses.ValidatorTimeLock, signerOrProvider);
    }

    public l1AllowList(signerOrProvider: Signer | providers.Provider) {
        return AllowListFactory.connect(this.addresses.AllowList, signerOrProvider);
    }

    public defaultERC20Bridge(signerOrProvider: Signer | providers.Provider) {
        return L1ERC20BridgeFactory.connect(this.addresses.Bridges.ERC20BridgeProxy, signerOrProvider);
    }

    public defaultWethBridge(signerOrProvider: Signer | providers.Provider) {
        return L1WethBridgeFactory.connect(this.addresses.Bridges.WethBridgeProxy, signerOrProvider);
    }
}
