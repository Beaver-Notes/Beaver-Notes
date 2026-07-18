use std::sync::atomic::AtomicBool;

pub(crate) static KEYRING_AVAILABLE: AtomicBool = AtomicBool::new(!cfg!(target_os = "android"));

mod keys;
mod assets;
mod legacy;

pub(crate) use keys::*;
pub(crate) use assets::*;
pub(crate) use legacy::*;

#[cfg(test)]
mod tests;
