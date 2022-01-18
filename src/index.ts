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

import {
    FantomScanProvider,
    DAO,
    ethers,
    DAOInformationHelper
} from '@brandonlehmann/ethers-providers';
import { Metronome } from 'node-metronome';
import Logger from '@turtlepay/logger';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import Tools from './tools';

config();

const DAO_INFORMATION_HELPER = process.env.DAO_INFORMATION_HELPER || '0x260A5367c0e742a1fdE32cDB13973F67c92149Ed';
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
const ADDITIONAL_BONDS: string[] = [];

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
    Logger.warn('For this bot to automatically claim and stake bonds on your behalf, you must');
    Logger.warn('fund it with some FTM so that it can send transactions that will claim and stake');
    Logger.warn('your bonds. You do not have to give it much, but given that it will send about three');
    Logger.warn('transactions a day, it may be wise to make sure that the bot wallet has');
    Logger.warn('1 FTM available and top it up ever day or so.');
    Logger.warn('');
    Logger.warn('Please make sure that you have funded this address with FTM');
    Logger.warn('%s', wallet.address);
    Logger.warn('It currently has %s FTM available', ethers.utils.formatEther(await wallet.getBalance()));
    Logger.warn('');
    Logger.warn('If you find this bot useful, please consider funding my coffee addiction');
    Logger.warn('I gladly accept FTM, EXOD, sEXOD, wsEXOD etc to: ');
    Logger.warn('0x3F1066f18EdB21aC6dB63630C8241400B7FB0f06');
    Logger.warn('');
    Logger.warn('---------------------------------------------------------------------------------');

    await Tools.sleep(5);

    const helper = await provider.load_contract(DAO.BondInformationHelper, BOND_INFORMATION_HELPER);

    Logger.info('Loaded Bond Information Helper from: %s', BOND_INFORMATION_HELPER);

    const DAOhelper = await provider.load_contract(DAOInformationHelper, DAO_INFORMATION_HELPER);

    Logger.info('Loaded DAO Information Helper from: %s', DAO_INFORMATION_HELPER);

    const redeemHelper = await provider.load_contract(DAO.RedeemHelper, REDEEM_HELPER);

    await redeemHelper.connect(wallet);

    Logger.info('Loaded Redeem Helper from: %s', REDEEM_HELPER);

    Logger.info('---------------------------------------------------------------------------------');

    Logger.info('Fetching all Bond ABIs and loading them');

    const bonds = await Tools.getBonds(provider, redeemHelper, helper, wallet, undefined, ADDITIONAL_BONDS);

    Logger.info('Loaded %s Bond ABIs', bonds.size);

    Logger.info('---------------------------------------------------------------------------------');
    Logger.info('------------------------   STARTING BOT WATCH LOOP   ----------------------------');
    Logger.info('---------------------------------------------------------------------------------');

    timer.on('tick', async () => {
        const info = await Tools.getLoopData(
            DAOhelper,
            STAKING_CONTRACT,
            STAKED_TOKEN_CONTRACT,
            BLOCK_TIME_TRACKER,
            myStakingWallet
        );

        const rates = {
            daily: Tools.compoundRate(info.rebaseRate, 1, info.epochsPerDay),
            fourDay: Tools.compoundRate(info.rebaseRate, 4, info.epochsPerDay),
            fiveDay: Tools.compoundRate(info.rebaseRate, 5, info.epochsPerDay),
            weekly: Tools.compoundRate(info.rebaseRate, 7, info.epochsPerDay),
            monthly: Tools.compoundRate(info.rebaseRate, 30, info.epochsPerDay),
            yearly: Tools.compoundRate(info.rebaseRate, 365, info.epochsPerDay)
        };

        const bondPayout = await Tools.checkBonds(bonds, myStakingWallet);

        Logger.info('---------------------------------------------------------------------------------');
        Logger.info('---------------------------   BOT CHECK INTERVAL   ------------------------------');
        Logger.info('---------------------------------------------------------------------------------');
        Logger.info('Status');
        Logger.info('');
        Logger.info('\t\tBlock             : %s => Epoch End: %s in ~%s', info.blockNumber, info.endBlock, Tools.secondsToHuman(info.delta));
        Logger.info('\t\tBot Wallet        : %s', wallet.address);
        Logger.info('\t\tBot Balance       : %s FTM', ethers.utils.formatEther(await wallet.getBalance()));
        Logger.info('');
        Logger.info('\t\tStaker Address    : %s', myStakingWallet);
        Logger.info('\t\tMy Claimable Bonds: %s %s', bondPayout, TOKEN_SYMBOL);
        Logger.info('\t\tMy Staked Balance : %s %s', info.stakedTokenBalance, STAKED_TOKEN_SYMBOL);
        Logger.info('');
        Logger.info('---------------------------------------------------------------------------------');
        Logger.info('Current Rates');
        Logger.info('');
        Logger.info('\t\tCurrent Index : %s', Tools.formatNumber(info.index));
        Logger.info('\t\tEpoch Day     : %s', Tools.formatNumber(info.epochsPerDay));
        Logger.info('\t\tEpoch         : %s%', Tools.formatPercent(info.rebaseRate));
        Logger.info('\t\tDaily         : %s%', Tools.formatPercent(rates.daily));
        Logger.info('\t\tFour Day      : %s%', Tools.formatPercent(rates.fourDay));
        Logger.info('\t\tFive Day      : %s%', Tools.formatPercent(rates.fiveDay));
        Logger.info('\t\tWeekly        : %s%', Tools.formatPercent(rates.weekly));
        Logger.info('\t\tMonthly       : %s%', Tools.formatPercent(rates.monthly));
        Logger.info('\t\tYearly        : %s%', Tools.formatPercent(rates.yearly));
        Logger.info('');
        Logger.info('---------------------------------------------------------------------------------');

        // if we're less than 5 minutes away and we haven't don't this already...
        if (info.delta <= 5 * 60 && !epochs.has(info.epochNumber) && bondPayout > 0) {
            timer.toggle();

            Logger.warn('Trying to Redeem & Stake all Bonds');

            try {
                const receipts = await Tools.redeemBonds(redeemHelper, myStakingWallet, bonds, ADDITIONAL_BONDS);

                for (const receipt of receipts) {
                    epochs.set(info.epochNumber, receipt.blockNumber);

                    Logger.info('Redeemed & Staked via %s in block %s', receipt.transactionHash, receipt.blockNumber);
                }
            } catch (e: any) {
                Logger.error('Error redeeming & staking bonds: %s', e.toString());
            }

            timer.toggle();
        }
    });

    timer.tick();
})();
