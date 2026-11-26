# 第三方组件许可清单（vendor/win32-x64/flash-sh.exe）

flash-sh.exe 由 flash-sh 的 Rust 源码（作者自研，源码暂未公开）静态编译而成，下表是 x86_64-pc-windows-gnu 目标下
实际进入构建图的全部 crate（`cargo metadata --filter-platform x86_64-pc-windows-gnu`，仅 normal 依赖，18 个）。
多许可（`A OR B`）的 crate 按其中任一许可使用；本包选择 MIT（有 MIT 选项时），否则 Apache-2.0。
各 crate 所选许可的**全文与版权声明**在同目录的 THIRD_PARTY_LICENSE_TEXTS.txt（由 Cargo 源码包里的 LICENSE 文件按全文去重生成）。

| crate | 版本 | 许可 | 仓库 |
|---|---|---|---|
| aho-corasick | 1.1.5 | Unlicense OR MIT | https://github.com/BurntSushi/aho-corasick |
| block-buffer | 0.12.1 | MIT OR Apache-2.0 | https://github.com/RustCrypto/utils |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 | https://github.com/rust-lang/cfg-if |
| const-oid | 0.10.3 | Apache-2.0 OR MIT | https://github.com/RustCrypto/formats |
| cpufeatures | 0.3.1 | MIT OR Apache-2.0 | https://github.com/RustCrypto/utils |
| crypto-common | 0.2.2 | MIT OR Apache-2.0 | https://github.com/RustCrypto/traits |
| digest | 0.11.3 | MIT OR Apache-2.0 | https://github.com/RustCrypto/traits |
| hybrid-array | 0.4.15 | MIT OR Apache-2.0 | https://github.com/RustCrypto/hybrid-array |
| md-5 | 0.11.0 | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes |
| memchr | 2.8.3 | Unlicense OR MIT | https://github.com/BurntSushi/memchr |
| regex | 1.13.2 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex |
| regex-automata | 0.4.19 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex |
| regex-syntax | 0.8.12 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT | https://github.com/rust-lang/rustc-hash |
| sha2 | 0.11.1 | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes |
| typenum | 1.20.1 | MIT OR Apache-2.0 | https://github.com/paholg/typenum |
| windows-link | 0.2.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
