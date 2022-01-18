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
    BigNumber,
    DAO,
    FantomScanProvider,
    ethers,
    DAOInformationHelper
} from '@brandonlehmann/ethers-providers';
import * as Numeral from 'numeral';
import { resolve } from 'path';
import Logger from '@turtlepay/logger';

export type Bonds = Map<string, {name: string, bond: DAO.Bond, redeemHelper: boolean}>;

const SECONDS_IN_A_DAY = 60 * 60 * 24;
const sleep = async (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout * 1000));

export interface StakingInformation {
    epochNumber: number;
    rebaseRate: number;
    epochsPerDay: number;
    blockNumber: number;
    endBlock: number;
    delta: number;
    stakedTokenBalance: number;
    index: number;
}

export default class Tools {
    public static async sleep (timeout: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, timeout * 1000));
    }

    public static secondsToHuman (seconds: number): string {
        return new Date(seconds * 1000).toISOString()
            .substr(11, 8);
    }

    public static formatNumber (value: number): string {
        return Numeral(value)
            .format('0,0.0000')
            .padStart(14, ' ');
    }

    public static formatPercent (value: number | BigNumber): string {
        if (typeof value === 'undefined') {
            return Numeral(0)
                .format('0,0.0000')
                .padStart(14, ' ');
        }

        if (value instanceof BigNumber) {
            value = value.toNumber();
        }

        value *= 100;

        return Numeral(value)
            .format('0,0.0000')
            .padStart(14, ' ');
    }

    public static path (value: string): string {
        return resolve(process.cwd() + '/' + value);
    }

    public static async getBonds (
        scanner: FantomScanProvider,
        redeemHelper: DAO.RedeemHelper,
        helper: DAO.BondInformationHelper,
        wallet: ethers.Wallet,
        maxBonds = 20,
        additionalBonds: string[] = []
    ): Promise<Bonds> {
        const result: Bonds = new Map<string, {name: string, bond: DAO.Bond, redeemHelper: boolean}>();

        Logger.info('---------------------------------------------------------------------------------');
        Logger.info('Fetching all Bond ABIs and loading them');
        Logger.info('');

        const bond_addresses = await redeemHelper.getBonds(maxBonds);
        for (const bond of additionalBonds) {
            bond_addresses.push(bond);
        }

        for (const contract_address of bond_addresses) {
            const attempt = async (): Promise<void> => {
                try {
                    const bond = await scanner.load_contract(DAO.Bond, contract_address, 'IGNORED');

                    await bond.connectWallet(wallet);

                    const symbols = await helper.symbol(contract_address);

                    const terms = await bond.terms();

                    const tag = (terms.vestingTerm.toNumber() === 345600) ? '(4,4)' : '(1,1)';

                    const symbol = (symbols.symbol1.length !== 0) ? symbols.symbol0 + '-' + symbols.symbol1 + ' LP' : symbols.symbol0;

                    const name = symbol + ' ' + tag;

                    const usesHelper = !additionalBonds.includes(bond.contract_address);

                    result.set(contract_address, {
                        name: name,
                        bond: bond,
                        redeemHelper: usesHelper
                    });

                    Logger.info('Loaded bond for %s: %s', name.padStart(20, ' '), contract_address);
                } catch {
                    Logger.warn('Error loading bond ABI, pausing 2 seconds to try again...');

                    await sleep(2);

                    return attempt();
                }
            };

            await attempt();
        }

        Logger.info('');
        Logger.info('Loaded %s Bond ABIs', result.size);
        Logger.info('---------------------------------------------------------------------------------');

        return result;
    }

    public static async checkBonds (
        bonds: Bonds,
        myStakingWallet: string,
        ignoreAdditional = false
    ): Promise<number> {
        let result = BigNumber.from(0);

        for (const [, elem] of bonds) {
            if (ignoreAdditional && !elem.redeemHelper) {
                Logger.debug('Skipping %s in pending payout check of all bonds', elem.bond.contract_address);
                continue;
            }

            const attempt = async (): Promise<void> => {
                try {
                    const payout = await elem.bond.pendingPayoutFor(myStakingWallet);

                    result = result.add(payout);
                } catch {
                    Logger.warn('Error checking bond [%s] payout for %s', elem.name, myStakingWallet);

                    await sleep(2);

                    return attempt();
                }
            };

            await attempt();
        }

        return parseFloat(ethers.utils.formatUnits(result, 'gwei'));
    }

    public static compoundRate (rate: number, days = 1, epochsPerDay = 1): number {
        return Math.pow(1 + rate, epochsPerDay * days) - 1;
    }

    public static async getLoopData (
        helper: DAOInformationHelper,
        staking: string,
        stakedToken: string,
        timetracker: string,
        myStakingWallet: string
    ): Promise<StakingInformation> {
        const attempt = async (): Promise<StakingInformation> => {
            try {
                const result = await helper.info(staking, stakedToken, timetracker, myStakingWallet);

                const bps = result.blockAverage.toNumber() / Math.pow(10, result.blockPrecision);

                const blocksPerDay = bps * SECONDS_IN_A_DAY;

                const epochsPerDay = blocksPerDay / result.epochLength.toNumber();

                const rebaseRate = result.epochDistribute.toNumber() / result.stakedCirculatingSupply.toNumber();

                const epochNumber = result.epochNumber.toNumber();

                const endBlock = result.epochEndBlock.toNumber();

                const delta = endBlock - result.blockNumber.toNumber();

                const stakedTokenBalance = parseFloat(ethers.utils.formatUnits(result.stakingBalance, 'gwei'));

                const index = result.stakingIndex.toNumber() / Math.pow(10, result.stakedDecimals);

                return {
                    epochNumber,
                    rebaseRate,
                    epochsPerDay,
                    blockNumber: result.blockNumber.toNumber(),
                    endBlock,
                    delta,
                    stakedTokenBalance,
                    index
                };
            } catch {
                Logger.warn('Error pulling current data');

                await sleep(2);

                return attempt();
            }
        };

        return await attempt();
    }

    public static async redeemBonds (
        redeemHelper: DAO.RedeemHelper,
        myStakingWallet: string,
        bonds: Bonds,
        additionalBonds: string[] = []
    ): Promise<ethers.ContractReceipt[]> {
        const receipts: ethers.ContractReceipt[] = [];

        const getBond = (contract: string): DAO.Bond | undefined => {
            if (bonds.has(contract)) {
                const data = bonds.get(contract);

                if (data) {
                    return data.bond;
                }
            }
        };

        const attemptRedeemAll = async (): Promise<ethers.ContractReceipt> => {
            const result = await redeemHelper.execute(
                redeemHelper.redeemAll(myStakingWallet, true), 2);

            return result.receipt;
        };

        const attemptRedeemSingle = async (bond: DAO.Bond): Promise<ethers.ContractReceipt> => {
            const result = await bond.execute(
                bond.redeem(myStakingWallet, true), 2);

            return result.receipt;
        };

        if (await this.checkBonds(bonds, myStakingWallet, true) > 0) {
            Logger.warn('Awaiting Redeem & Stake All Transaction');

            const receipt = await attemptRedeemAll();

            receipts.push(receipt);

            Logger.warn('Redeem & Stake All Completed: %s', receipt.transactionHash);
        }

        for (const bond_contract of additionalBonds) {
            const bond = getBond(bond_contract);

            if (bond) {
                if ((await bond.pendingPayoutFor(myStakingWallet)).gt(BigNumber.from(0))) {
                    Logger.warn('Awaiting Redeem & Stake: %s', bond.contract_address);

                    const receipt = await attemptRedeemSingle(bond);

                    receipts.push(receipt);

                    Logger.warn('Redeem & Stake [%s] Completed: %s', bond.contract_address, receipt.transactionHash);
                }
            }
        }

        return receipts;
    }
}
