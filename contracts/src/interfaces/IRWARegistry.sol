// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IRWARegistry {
    enum AssetClass {
        Treasury,
        GlobalBond,
        PrivateCredit,
        InstitutionalFund,
        Equity,
        Commodity
    }

    struct Asset {
        address token;
        address issuer;
        uint256 navPerToken; // USD per token, 1e18
        uint64 navUpdatedAt;
        uint32 settlementWindow; // seconds
        uint16 baseSpreadBps;
        uint16 dailyVolBps; // one-day NAV volatility, bps
        uint16 creditBps; // expected loss on a redemption in flight, bps
        uint16 maxExposureBps; // cap on outstanding vs vault total, per asset
        AssetClass assetClass;
        bool eligible; // bridge entity is an eligible redeemer with this issuer
        bool enabled;
    }

    function getAsset(address token) external view returns (Asset memory);
    function isRegistered(address token) external view returns (bool);
    function horizonDays(address token) external view returns (uint256);
    function secondsPerDay() external view returns (uint32);
    function tokenCount() external view returns (uint256);
    function tokens(uint256 index) external view returns (address);
    function setCredit(address token, uint16 creditBps) external;
    function setMaxExposure(address token, uint16 bps) external;
}
