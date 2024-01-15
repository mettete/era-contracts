// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import "../libraries/Diamond.sol";
import "./facets/Base.sol";

import {L2_TX_MAX_GAS_LIMIT, L2_TO_L1_LOG_SERIALIZE_SIZE, REQUIRED_L2_GAS_PRICE_PER_PUBDATA, SYSTEM_UPGRADE_L2_TX_TYPE} from "../../common/Config.sol";
import {L2_SYSTEM_CONTEXT_SYSTEM_CONTRACT_ADDR, L2_BOOTLOADER_ADDRESS} from "../../common/L2ContractAddresses.sol";
import {InitializeData, IDiamondInit} from "../chain-interfaces/IDiamondInit.sol";

import "../l2-deps/ISystemContext.sol";

/// @author Matter Labs
/// @dev The contract is used only once to initialize the diamond proxy.
/// @dev The deployment process takes care of this contract's initialization.
contract DiamondInit is ZkSyncStateTransitionBase, IDiamondInit {
    /// @dev Initialize the implementation to prevent any possibility of a Parity hack.
    constructor() reentrancyGuardInitializer {}

    /// @notice zkSync contract initialization
    /// @return Magic 32 bytes, which indicates that the contract logic is expected to be used as a diamond proxy
    /// initializer
    function initialize(InitializeData calldata _initializeData) external reentrancyGuardInitializer returns (bytes32) {
        require(address(_initializeData.verifier) != address(0), "vt");
        require(_initializeData.governor != address(0), "vy");
        require(_initializeData.admin != address(0), "hc");
        require(_initializeData.priorityTxMaxGasLimit <= L2_TX_MAX_GAS_LIMIT, "vu");

        s.chainId = _initializeData.chainId;
        s.bridgehub = _initializeData.bridgehub;
        s.stateTransitionManager = _initializeData.stateTransitionManager;
        s.baseToken = _initializeData.baseToken;
        s.baseTokenBridge = _initializeData.baseTokenBridge;
        s.protocolVersion = _initializeData.protocolVersion;

        s.verifier = _initializeData.verifier;
        s.governor = _initializeData.governor;
        s.admin = _initializeData.admin;

        s.storedBatchHashes[0] = _initializeData.storedBatchZero;
        s.verifierParams = _initializeData.verifierParams;
        s.l2BootloaderBytecodeHash = _initializeData.l2BootloaderBytecodeHash;
        s.l2DefaultAccountBytecodeHash = _initializeData.l2DefaultAccountBytecodeHash;
        s.priorityTxMaxGasLimit = _initializeData.priorityTxMaxGasLimit;

        // While this does not provide a protection in the production, it is needed for local testing
        // Length of the L2Log encoding should not be equal to the length of other L2Logs' tree nodes preimages
        assert(L2_TO_L1_LOG_SERIALIZE_SIZE != 2 * 32);

        return Diamond.DIAMOND_INIT_SUCCESS_RETURN_VALUE;
    }
}
