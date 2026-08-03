//! Commerce invoice settle program for Solana.
//!
//! Invoice PDA seeds: `["invoice", invoice_id (32), merchant, mint]`.
//! SPL tokens live in the PDA's ATA. `settle` pays only the bound merchant (+ fee).
//! Mint is part of the PDA — USDC and USDT (any configured mint) use the same path.
//! Sweeper is an authority that can trigger settle — it cannot redirect funds.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use spl_associated_token_account::get_associated_token_address;
use spl_token::state::Account as TokenAccount;

pub const CONFIG_SEED: &[u8] = b"config";
pub const INVOICE_SEED: &[u8] = b"invoice";

entrypoint!(process_instruction);

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Config {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum CommerceInstruction {
    /// Create config PDA. Accounts: payer, config, system_program.
    Initialize {
        fee_bps: u16,
        authority: Pubkey,
        fee_recipient: Pubkey,
    },
    /// Sweep invoice ATA → merchant (+ fee). Accounts listed in `settle`.
    Settle { invoice_id: [u8; 32] },
}

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

pub fn invoice_pda(
    program_id: &Pubkey,
    invoice_id: &[u8; 32],
    merchant: &Pubkey,
    mint: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            INVOICE_SEED,
            invoice_id.as_ref(),
            merchant.as_ref(),
            mint.as_ref(),
        ],
        program_id,
    )
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let ix = CommerceInstruction::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        CommerceInstruction::Initialize {
            fee_bps,
            authority,
            fee_recipient,
        } => initialize(program_id, accounts, fee_bps, authority, fee_recipient),
        CommerceInstruction::Settle { invoice_id } => settle(program_id, accounts, invoice_id),
    }
}

fn initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    fee_bps: u16,
    authority: Pubkey,
    fee_recipient: Pubkey,
) -> ProgramResult {
    if fee_bps > 10_000 {
        return Err(ProgramError::InvalidArgument);
    }
    let iter = &mut accounts.iter();
    let payer = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let system_program = next_account_info(iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (expected, bump) = config_pda(program_id);
    if config_info.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_info.owner == program_id {
        msg!("config already initialized");
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let rent = Rent::get()?;
    let space = 128;
    let lamports = rent.minimum_balance(space);
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            config_info.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[payer.clone(), config_info.clone(), system_program.clone()],
        &[&[CONFIG_SEED, &[bump]]],
    )?;

    let config = Config {
        authority,
        fee_recipient,
        fee_bps,
        bump,
    };
    config.serialize(&mut *config_info.try_borrow_mut_data()?)?;
    Ok(())
}

/// Accounts (in order):
/// 0. authority (signer) — must match config.authority
/// 1. config PDA
/// 2. merchant pubkey (owner of destination ATA)
/// 3. invoice PDA
/// 4. invoice ATA (owned by invoice PDA)
/// 5. merchant token ATA
/// 6. fee recipient token ATA
/// 7. SPL mint (bound into PDA seeds)
/// 8. token program
/// 9. rent reclaim destination (writable; receives closed ATA lamports)
fn settle(program_id: &Pubkey, accounts: &[AccountInfo], invoice_id: [u8; 32]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config_info = next_account_info(iter)?;
    let merchant = next_account_info(iter)?;
    let invoice_info = next_account_info(iter)?;
    let invoice_ata = next_account_info(iter)?;
    let merchant_ata = next_account_info(iter)?;
    let fee_ata = next_account_info(iter)?;
    let mint = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;
    let rent_destination = next_account_info(iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let data = config_info.try_borrow_data()?;
    let config = Config::deserialize(&mut &data[..]).map_err(|_| ProgramError::InvalidAccountData)?;
    let (expected_config, _) = config_pda(program_id);
    if config_info.key != &expected_config || config_info.owner != program_id {
        return Err(ProgramError::InvalidAccountData);
    }
    if authority.key != &config.authority {
        msg!("unauthorized sweeper");
        return Err(ProgramError::Custom(1));
    }

    let (expected_invoice, invoice_bump) =
        invoice_pda(program_id, &invoice_id, merchant.key, mint.key);
    if invoice_info.key != &expected_invoice {
        return Err(ProgramError::InvalidSeeds);
    }

    let expected_invoice_ata = get_associated_token_address(&expected_invoice, mint.key);
    if invoice_ata.key != &expected_invoice_ata {
        return Err(ProgramError::InvalidAccountData);
    }
    let expected_merchant_ata = get_associated_token_address(merchant.key, mint.key);
    if merchant_ata.key != &expected_merchant_ata {
        return Err(ProgramError::InvalidAccountData);
    }
    let expected_fee_ata = get_associated_token_address(&config.fee_recipient, mint.key);
    if fee_ata.key != &expected_fee_ata {
        return Err(ProgramError::InvalidAccountData);
    }

    let ata = TokenAccount::unpack(&invoice_ata.try_borrow_data()?)?;
    if ata.mint != *mint.key || ata.owner != expected_invoice {
        return Err(ProgramError::InvalidAccountData);
    }
    let amount = ata.amount;
    if amount == 0 {
        return Err(ProgramError::InsufficientFunds);
    }

    let fee = (amount as u128)
        .checked_mul(config.fee_bps as u128)
        .ok_or(ProgramError::InvalidArgument)?
        .checked_div(10_000)
        .ok_or(ProgramError::InvalidArgument)? as u64;
    let to_merchant = amount.saturating_sub(fee);

    let signer_seeds: &[&[u8]] = &[
        INVOICE_SEED,
        invoice_id.as_ref(),
        merchant.key.as_ref(),
        mint.key.as_ref(),
        &[invoice_bump],
    ];

    if to_merchant > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                invoice_ata.key,
                merchant_ata.key,
                &expected_invoice,
                &[],
                to_merchant,
            )?,
            &[
                invoice_ata.clone(),
                merchant_ata.clone(),
                invoice_info.clone(),
                token_program.clone(),
            ],
            &[signer_seeds],
        )?;
    }
    if fee > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                invoice_ata.key,
                fee_ata.key,
                &expected_invoice,
                &[],
                fee,
            )?,
            &[
                invoice_ata.clone(),
                fee_ata.clone(),
                invoice_info.clone(),
                token_program.clone(),
            ],
            &[signer_seeds],
        )?;
    }

    invoke_signed(
        &spl_token::instruction::close_account(
            token_program.key,
            invoice_ata.key,
            rent_destination.key,
            &expected_invoice,
            &[],
        )?,
        &[
            invoice_ata.clone(),
            rent_destination.clone(),
            invoice_info.clone(),
            token_program.clone(),
        ],
        &[signer_seeds],
    )?;

    Ok(())
}
