use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<SpotSearch<R>> {
    Ok(SpotSearch(app.clone()))
}

pub struct SpotSearch<R: Runtime>(AppHandle<R>);

impl<R: Runtime> SpotSearch<R> {
    pub fn enable_indexing(&self, _enabled: bool) -> crate::Result<()> {
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    pub fn index_items(&self, _request: crate::IndexItemsRequest) -> crate::Result<()> {
        Ok(())
    }

    #[cfg(target_os = "macos")]
    pub fn index_items(&self, request: crate::IndexItemsRequest) -> crate::Result<()> {
        let json =
            serde_json::to_string(&request).map_err(|e| crate::Error::Other(e.to_string()))?;
        macos_spotlight::call(|out_error| unsafe {
            macos_spotlight::ffi::spotsearch_index_items(
                std::ffi::CString::new(json).unwrap().as_ptr(),
                out_error,
            )
        })
    }

    #[cfg(not(target_os = "macos"))]
    pub fn delete_items(&self, _request: crate::DeleteItemsRequest) -> crate::Result<()> {
        Ok(())
    }

    #[cfg(target_os = "macos")]
    pub fn delete_items(&self, request: crate::DeleteItemsRequest) -> crate::Result<()> {
        let json =
            serde_json::to_string(&request).map_err(|e| crate::Error::Other(e.to_string()))?;
        macos_spotlight::call(|out_error| unsafe {
            macos_spotlight::ffi::spotsearch_delete_items(
                std::ffi::CString::new(json).unwrap().as_ptr(),
                out_error,
            )
        })
    }

    #[cfg(not(target_os = "macos"))]
    pub fn delete_domain(&self, _request: crate::DeleteDomainRequest) -> crate::Result<()> {
        Ok(())
    }

    #[cfg(target_os = "macos")]
    pub fn delete_domain(&self, request: crate::DeleteDomainRequest) -> crate::Result<()> {
        macos_spotlight::call(|out_error| unsafe {
            macos_spotlight::ffi::spotsearch_delete_domain(
                std::ffi::CString::new(request.domain).unwrap().as_ptr(),
                out_error,
            )
        })
    }
}

#[cfg(target_os = "macos")]
mod macos_spotlight {
    use std::ffi::{c_char, c_int, CStr};

    pub(super) mod ffi {
        use std::ffi::{c_char, c_int};

        extern "C" {
            pub fn spotsearch_index_items(
                json_items: *const c_char,
                out_error: *mut *mut c_char,
            ) -> c_int;
            pub fn spotsearch_delete_items(
                json_ids: *const c_char,
                out_error: *mut *mut c_char,
            ) -> c_int;
            pub fn spotsearch_delete_domain(
                domain: *const c_char,
                out_error: *mut *mut c_char,
            ) -> c_int;
            pub fn spotsearch_free_error(error: *mut c_char);
        }
    }

    pub fn call<F>(f: F) -> crate::Result<()>
    where
        F: FnOnce(*mut *mut c_char) -> c_int,
    {
        let mut out_error: *mut c_char = std::ptr::null_mut();
        let ret = f(&mut out_error);
        if ret != 0 {
            let err_msg = if out_error.is_null() {
                "Unknown error".to_string()
            } else {
                let msg = unsafe { CStr::from_ptr(out_error) }
                    .to_string_lossy()
                    .into_owned();
                unsafe { ffi::spotsearch_free_error(out_error) };
                msg
            };
            Err(crate::Error::Other(err_msg))
        } else {
            Ok(())
        }
    }
}
