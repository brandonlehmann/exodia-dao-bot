// Copyright (c) 2021, Brandon Lehmann <brandonlehmann@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { FantomScanProvider, DAO, ethers, BigNumber, TimeTracker } from '@brandonlehmann/ethers-providers';
import { Metronome } from 'node-metronome';
import Logger from '@turtlepay/logger';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import Tools from './tools';

config();

const SECONDS_IN_A_DAY = 60 * 60 * 24;
const myStakingWallet = process.env.DAO_WALLET_ADDRESS || undefined;
const defaultWalletFilename = process.env.BOT_WALLET_FILENAME || 'token.wallet';
const defaultWalletPassword = process.env.BOT_WALLET_PASSWORD || '';
const ftmScanAPIKey = process.env.FTM_SCAN_API_KEY || undefined;
const BOND_INFORMATION_HELPER = process.env.BOND_INFORMATION_HELPER || '0xd915Aff2F6AFB96F4d8765C663b60c8a5AdC6729';
const BLOCK_TIME_TRACKER = process.env.BLOCK_TIME_TRACKER || '0x706e05D2b47cc6B1fb615EE76DD3789d2329E22e';
const STAKED_TOKEN_CONTRACT = process.env.STAKED_TOKEN_CONTARCT || '0x8de250c65636ef02a75e4999890c91cecd38d03d';
const STAKING_CONTRACT = process.env.STAKING_CONTRACT || '0x8b8d40f98a2f14e2dd972b3f2e2a2cc227d1e3be';
const REDEEM_HELPER = process.env.REDEEM_HELPER || '0x9d1530475b6282bd92da5628e36052f70c56a208';
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || 'EXOD';
const STAKED_TOKEN_SYMBOL = process.env.STAKED_TOKEN_SYMBOL || 'sEXOD';

if (!myStakingWallet) {
    Logger.error('---------------------------------------------------------------------------------');
    Logger.error('You did not specify the staking wallet address in the DAO_WALLET_ADDRESS ');
    Logger.error('environment variable or in a .env file.');
    Logger.error('This must be done via: EXPORT DAO_WALLET_ADDRESS=<walletaddress> before starting');
    Logger.error('---------------------------------------------------------------------------------');
    process.exit(1);
}

if (!defaultWalletPassword) {
    Logger.error('---------------------------------------------------------------------------------');
    Logger.error('You did not specify a bot service wallet password in the BOT_WALLET_PASSWORD ');
    Logger.error('environment variable or in a .env file.');
    Logger.error('This is probably not a good idea...');
    Logger.error('---------------------------------------------------------------------------------');
}

if (!ftmScanAPIKey) {
    Logger.warn('---------------------------------------------------------------------------------');
    Logger.warn('You are using a community FTMscan API key. Please consider getting your own ');
    Logger.warn('API key from https://ftmscan.com/');
    Logger.warn('Once you have that API key, you can export it as FTM_SCAN_API_KEY=<apikey>');
    Logger.warn('---------------------------------------------------------------------------------');
}

const loadWallet = async (provider: ethers.providers.Provider): Promise<ethers.Wallet> => {
    const save = async (wallet: ethers.Wallet): Promise<void> => {
        const json = await wallet.encrypt(defaultWalletPassword);

        return writeFileSync(Tools.path(defaultWalletFilename), json);
    };

    if (!existsSync(Tools.path(defaultWalletFilename))) {
        const wallet = (await ethers.Wallet.createRandom()).connect(provider);

        Logger.info('Created new wallet: %s', wallet.address);

        await save(wallet);

        return wallet;
    }

    const file = readFileSync(Tools.path(defaultWalletFilename)).toString();

    const wallet = (await ethers.Wallet.fromEncryptedJson(file, defaultWalletPassword)).connect(provider);

    Logger.info('Wallet loaded from: %s', Tools.path(defaultWalletFilename));
    Logger.info('Wallet address: %s', wallet.address);

    return wallet;
};

const RPCProvider = new ethers.providers.JsonRpcProvider('https://rpc.ftm.tools', 250);

(async () => {
    const epochs = new Map<number, number>();

    const timer = new Metronome(60 * 1000, true);

    const provider = new FantomScanProvider(ftmScanAPIKey);

    const wallet = await loadWallet(RPCProvider);

    Logger.warn('---------------------------------------------------------------------------------');
    Logger.warn('');
    Logger.warn('For this bot to automatically claim and stake rebases on your behalf, you must');
    Logger.warn('fund it with some FTM so that it can send transactions that will claim and stake');
    Logger.warn('your bonds. You do not have to give it much, but given that it will send three');
    Logger.warn('transactions a day, it may be wise to make sure that the bot wallet has');
    Logger.warn('1 FTM available and top it up ever day or so.');
    Logger.warn('');
    Logger.warn('Please make sure that you have funded this address with FTM');
    Logger.warn('%s', wallet.address);
    Logger.warn('It current has %s FTM available', ethers.utils.formatEther(await wallet.getBalance()));
    Logger.warn('');
    Logger.warn('If you find this bot useful, please consider funding my coffee addiction');
    Logger.warn('I gladly accept FTM, HEC, sHEC, wsHEC, EXOD, sEXOD etc to: ');
    Logger.warn('0x3F1066f18EdB21aC6dB63630C8241400B7FB0f06');
    Logger.warn('');
    Logger.warn('---------------------------------------------------------------------------------');

    await Tools.sleep(5);

    const helper = await provider.load_contract(DAO.BondInformationHelper, BOND_INFORMATION_HELPER);

    Logger.info('Loaded BondInformation helper from: %s', BOND_INFORMATION_HELPER);

    const timetracker = await provider.load_contract(TimeTracker, BLOCK_TIME_TRACKER);

    await timetracker.connect(RPCProvider);

    Logger.info('Loaded Block Time Tracker from: %s', BLOCK_TIME_TRACKER);

    const stakedToken = await provider.load_contract(DAO.StakedToken, STAKED_TOKEN_CONTRACT);

    await stakedToken.connect(RPCProvider);

    Logger.info('Loaded Staked Token contract from: %s', STAKED_TOKEN_CONTRACT);

    const staking = await provider.load_contract(DAO.Staking, STAKING_CONTRACT, TOKEN_SYMBOL, STAKED_TOKEN_SYMBOL);

    await staking.connectWallet(wallet);

    Logger.info('Loaded staking contract from: %s', STAKING_CONTRACT);

    const redeemHelper = await provider.load_contract(DAO.RedeemHelper, REDEEM_HELPER);

    await redeemHelper.connect(wallet);

    Logger.info('Loaded redeem helper contract from: %s', REDEEM_HELPER);

    Logger.info('---------------------------------------------------------------------------------');

    Logger.info('Fetching all Bond ABIs and loading them');

    const bonds = await Tools.getBonds(provider, redeemHelper, helper);

    Logger.info('Loaded %s Bond ABIs', bonds.size);

    const stakedCirculatingSupply = async (): Promise<BigNumber> => {
        return stakedToken.circulatingSupply();
    };

    Logger.info('---------------------------------------------------------------------------------');
    Logger.info('------------------------   STARTING BOT WATCH LOOP   ----------------------------');
    Logger.info('---------------------------------------------------------------------------------');

    timer.on('tick', async () => {
        const blockNumber = await staking.contract.provider.getBlockNumber();

        const epoch = await staking.epoch();

        const circulatingSupply = (await stakedCirculatingSupply()).toNumber();

        const stakingReward = epoch.distribute.toNumber();

        const epochLength = epoch._length.toNumber();

        const bps = await timetracker.average();

        const blocksPerDay = bps * SECONDS_IN_A_DAY;

        const epochsPerDay = blocksPerDay / epochLength;

        const rebaseRate = stakingReward / circulatingSupply;

        const rates = {
            daily: Tools.compoundRate(rebaseRate, 1, epochsPerDay),
            fourDay: Tools.compoundRate(rebaseRate, 4, epochsPerDay),
            fiveDay: Tools.compoundRate(rebaseRate, 5, epochsPerDay),
            weekly: Tools.compoundRate(rebaseRate, 7, epochsPerDay),
            monthly: Tools.compoundRate(rebaseRate, 30, epochsPerDay),
            yearly: Tools.compoundRate(rebaseRate, 365, epochsPerDay)
        };

        const epochNumber = epoch.number.toNumber();

        const endBlock = epoch.endBlock.toNumber();

        const delta = endBlock - blockNumber;

        const bondPayout = await Tools.checkBonds(bonds, myStakingWallet);

        Logger.info('Block: %s => Epoch End: %s in %s', blockNumber, endBlock, Tools.secondsToHuman(delta));
        Logger.info('My Balance: %s FTM', ethers.utils.formatEther(await wallet.getBalance()));
        Logger.info('My Claimable Bonds: %s %s', ethers.utils.formatUnits(bondPayout, 'gwei'), TOKEN_SYMBOL);
        Logger.info('---------------------------------------------------------------------------------');
        Logger.info('Current Rates');
        Logger.info('');
        Logger.info('\t\tEpoch Day: %s', Tools.formatNumber(epochsPerDay));
        Logger.info('\t\tEpoch    : %s%', Tools.formatPercent(rebaseRate));
        Logger.info('\t\tDaily    : %s%', Tools.formatPercent(rates.daily));
        Logger.info('\t\tFour Day : %s%', Tools.formatPercent(rates.fourDay));
        Logger.info('\t\tFive Day : %s%', Tools.formatPercent(rates.fiveDay));
        Logger.info('\t\tWeekly   : %s%', Tools.formatPercent(rates.weekly));
        Logger.info('\t\tMonthly  : %s%', Tools.formatPercent(rates.monthly));
        Logger.info('\t\tYearly   : %s%', Tools.formatPercent(rates.yearly));
        Logger.info('');
        Logger.info('---------------------------------------------------------------------------------');

        // if we're less than 5 minutes away and we haven't don't this already...
        if (delta <= 5 * 60 && !epochs.has(epochNumber) && bondPayout.gt(BigNumber.from(0))) {
            timer.toggle();

            Logger.warn('Trying to Redeem & Stake all Bonds');

            try {
                const tx = await redeemHelper.redeemAll(myStakingWallet, true);

                Logger.warn('Waiting for transaction: %s', tx.hash);

                const receipt = await tx.wait(2);

                epochs.set(epochNumber, receipt.blockNumber);

                Logger.info('Redeemed & Staked All via %s in block %s', receipt.transactionHash, receipt.blockNumber);
            } catch {} finally {
                timer.toggle();
            }
        }
    });

    timer.tick();
})();
