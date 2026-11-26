# 第三方组件许可清单（vendor/win32-x64/flash-sh.exe）

flash-sh.exe 由 flash-sh 的 Rust 源码（作者自研，源码暂未公开）静态编译而成，下表是 x86_64-pc-windows-gnu 目标下
实际进入构建图的全部 crate（`cargo metadata --filter-platform x86_64-pc-windows-gnu`，仅 normal 依赖，225 个）。
多许可（`A OR B`）的 crate 按其中任一许可使用；本包选择 MIT（有 MIT 选项时），否则 CC0-1.0 / Apache-2.0。
各 crate 所选许可的**全文与版权声明**在同目录的 THIRD_PARTY_LICENSE_TEXTS.txt（由 Cargo 源码包里的 LICENSE 文件按全文去重生成）。

| crate | 版本 | 许可 | 仓库 |
|---|---|---|---|
| aho-corasick | 1.1.5 | Unlicense OR MIT | https://github.com/BurntSushi/aho-corasick |
| ansi-width | 0.1.1 | MIT | https://github.com/uutils/ansi-width |
| anstream | 1.0.0 | MIT OR Apache-2.0 | https://github.com/rust-cli/anstyle.git |
| anstyle | 1.0.14 | MIT OR Apache-2.0 | https://github.com/rust-cli/anstyle.git |
| anstyle-parse | 1.0.0 | MIT OR Apache-2.0 | https://github.com/rust-cli/anstyle.git |
| anstyle-query | 1.1.5 | MIT OR Apache-2.0 | https://github.com/rust-cli/anstyle.git |
| anstyle-wincon | 3.0.11 | MIT OR Apache-2.0 | https://github.com/rust-cli/anstyle.git |
| ariadne | 0.6.0 | MIT | https://github.com/zesterer/ariadne |
| base64-simd | 0.8.0 | MIT | https://github.com/Nugine/simd |
| bigdecimal | 0.4.11 | MIT/Apache-2.0 | https://github.com/akubera/bigdecimal-rs |
| bit-set | 0.8.0 | Apache-2.0 OR MIT | https://github.com/contain-rs/bit-set |
| bit-vec | 0.8.0 | Apache-2.0 OR MIT | https://github.com/contain-rs/bit-vec |
| bitflags | 2.13.2 | MIT OR Apache-2.0 | https://github.com/bitflags/bitflags |
| block-buffer | 0.12.1 | MIT OR Apache-2.0 | https://github.com/RustCrypto/utils |
| bstr | 1.14.0 | MIT OR Apache-2.0 | https://github.com/BurntSushi/bstr |
| bytecount | 0.6.9 | Apache-2.0/MIT | https://github.com/llogiq/bytecount |
| calendrical_calculations | 0.2.4 | Apache-2.0 | https://github.com/unicode-org/icu4x |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 | https://github.com/rust-lang/cfg-if |
| chacha20 | 0.10.2 | MIT OR Apache-2.0 | https://github.com/RustCrypto/stream-ciphers |
| clap | 4.6.9 | MIT OR Apache-2.0 | https://github.com/clap-rs/clap |
| clap_builder | 4.6.7 | MIT OR Apache-2.0 | https://github.com/clap-rs/clap |
| clap_lex | 1.1.2 | MIT OR Apache-2.0 | https://github.com/clap-rs/clap |
| colorchoice | 1.0.5 | MIT OR Apache-2.0 | https://github.com/rust-cli/anstyle.git |
| console | 0.16.6 | MIT | https://github.com/console-rs/console |
| const-oid | 0.10.3 | Apache-2.0 OR MIT | https://github.com/RustCrypto/formats |
| core_maths | 0.1.1 | MIT | https://github.com/robertbastian/core_maths |
| cpufeatures | 0.3.1 | MIT OR Apache-2.0 | https://github.com/RustCrypto/utils |
| crossbeam-deque | 0.8.8 | MIT OR Apache-2.0 | https://github.com/crossbeam-rs/crossbeam |
| crossbeam-epoch | 0.9.21 | MIT OR Apache-2.0 | https://github.com/crossbeam-rs/crossbeam |
| crossbeam-utils | 0.8.23 | MIT OR Apache-2.0 | https://github.com/crossbeam-rs/crossbeam |
| crypto-common | 0.2.2 | MIT OR Apache-2.0 | https://github.com/RustCrypto/traits |
| ctrlc | 3.5.3 | MIT/Apache-2.0 | https://github.com/Detegr/rust-ctrlc.git |
| data-encoding | 2.11.1 | MIT | https://github.com/ia0/data-encoding |
| data-encoding-macro | 0.1.21 | MIT | https://github.com/ia0/data-encoding |
| data-encoding-macro-internal | 0.1.19 | MIT | https://github.com/ia0/data-encoding |
| digest | 0.11.3 | MIT OR Apache-2.0 | https://github.com/RustCrypto/traits |
| displaydoc | 0.2.7 | MIT OR Apache-2.0 | https://github.com/yaahc/displaydoc |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 | https://gitlab.com/kornelski/dunce |
| either | 1.19.0 | MIT OR Apache-2.0 | https://github.com/rayon-rs/either |
| encode_unicode | 1.0.0 | Apache-2.0 OR MIT | https://github.com/tormol/encode_unicode |
| errno | 0.3.15 | MIT OR Apache-2.0 | https://github.com/lambda-fairy/rust-errno |
| fancy-regex | 0.20.2 | MIT | https://github.com/fancy-regex/fancy-regex |
| fastrand | 2.5.0 | Apache-2.0 OR MIT | https://github.com/smol-rs/fastrand |
| filetime | 0.2.30 | MIT/Apache-2.0 | https://github.com/alexcrichton/filetime |
| fixed_decimal | 0.7.3 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| fluent | 0.17.0 | Apache-2.0 OR MIT | https://github.com/projectfluent/fluent-rs |
| fluent-bundle | 0.16.0 | Apache-2.0 OR MIT | https://github.com/projectfluent/fluent-rs |
| fluent-langneg | 0.13.1 | Apache-2.0 OR MIT | https://github.com/projectfluent/fluent-langneg-rs |
| fluent-syntax | 0.12.0 | Apache-2.0 OR MIT | https://github.com/projectfluent/fluent-rs |
| foldhash | 0.2.0 | Zlib | https://github.com/orlp/foldhash |
| getrandom | 0.4.3 | MIT OR Apache-2.0 | https://github.com/rust-random/getrandom |
| glob | 0.3.4 | MIT OR Apache-2.0 | https://github.com/rust-lang/glob |
| half | 2.7.1 | MIT OR Apache-2.0 | https://github.com/VoidStarKat/half-rs |
| hostname | 0.4.2 | MIT | https://github.com/djc/hostname |
| hybrid-array | 0.4.15 | MIT OR Apache-2.0 | https://github.com/RustCrypto/hybrid-array |
| icu_calendar | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_calendar_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_collator | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_collator_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_collections | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_datetime | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_datetime_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_decimal | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_decimal_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_locale | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_locale_core | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_locale_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_locale_fallback | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_locale_fallback_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_normalizer | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_normalizer_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_pattern | 0.5.1 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_plurals | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_plurals_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_properties | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_properties_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_provider | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_time | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_time_data | 2.4.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| indicatif | 0.18.6 | MIT | https://github.com/console-rs/indicatif |
| intl-memoizer | 0.5.3 | Apache-2.0 OR MIT | https://github.com/projectfluent/fluent-rs |
| intl_pluralrules | 7.0.2 | Apache-2.0/MIT | https://github.com/zbraniecki/pluralrules |
| is_terminal_polyfill | 1.70.2 | MIT OR Apache-2.0 | https://github.com/polyfill-rs/is_terminal_polyfill |
| itertools | 0.15.0 | MIT OR Apache-2.0 | https://github.com/rust-itertools/itertools |
| itoa | 1.0.19 | MIT OR Apache-2.0 | https://github.com/dtolnay/itoa |
| jiff | 0.2.46 | Unlicense OR MIT | https://github.com/BurntSushi/jiff |
| jiff-core | 0.1.8 | Unlicense OR MIT | https://github.com/BurntSushi/jiff |
| jiff-icu | 0.2.4 | Unlicense OR MIT | https://github.com/BurntSushi/jiff |
| jiff-static | 0.2.46 | Unlicense OR MIT | https://github.com/BurntSushi/jiff |
| jiff-tzdb | 0.1.10 | Unlicense OR MIT | https://github.com/BurntSushi/jiff |
| jiff-tzdb-platform | 0.1.3 | Unlicense OR MIT | https://github.com/BurntSushi/jiff |
| keccak | 0.2.2 | Apache-2.0 OR MIT | https://github.com/RustCrypto/sponges |
| libc | 0.2.191 | MIT OR Apache-2.0 | https://github.com/rust-lang/libc |
| libm | 0.2.16 | MIT | https://github.com/rust-lang/compiler-builtins |
| litemap | 0.8.3 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| log | 0.4.35 | MIT OR Apache-2.0 | https://github.com/rust-lang/log |
| lscolors | 0.21.0 | MIT/Apache-2.0 | https://github.com/sharkdp/lscolors |
| md-5 | 0.11.0 | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes |
| memchr | 2.8.3 | Unlicense OR MIT | https://github.com/BurntSushi/memchr |
| memmap2 | 0.9.12 | MIT OR Apache-2.0 | https://github.com/RazrFalcon/memmap2-rs |
| nix | 0.31.4 | MIT | https://github.com/nix-rust/nix |
| nom | 8.0.0 | MIT | https://github.com/rust-bakery/nom |
| notify | 8.2.2 | CC0-1.0 | https://github.com/notify-rs/notify.git |
| notify-types | 2.3.1 | MIT OR Apache-2.0 | https://github.com/notify-rs/notify.git |
| nu-ansi-term | 0.50.3 | MIT | https://github.com/nushell/nu-ansi-term |
| num-bigint | 0.4.8 | MIT OR Apache-2.0 | https://github.com/rust-num/num-bigint |
| num-integer | 0.1.47 | MIT OR Apache-2.0 | https://github.com/rust-num/num-integer |
| num-traits | 0.2.19 | MIT OR Apache-2.0 | https://github.com/rust-num/num-traits |
| once_cell | 1.21.4 | MIT OR Apache-2.0 | https://github.com/matklad/once_cell |
| once_cell_polyfill | 1.70.2 | MIT OR Apache-2.0 | https://github.com/polyfill-rs/once_cell_polyfill |
| os_display | 0.1.4 | MIT | https://github.com/blyxxyz/os_display |
| outref | 0.5.2 | MIT | https://github.com/Nugine/outref |
| parse_datetime | 0.17.0 | MIT | https://github.com/uutils/parse_datetime |
| platform-info | 2.2.1 | MIT | https://github.com/uutils/platform-info |
| portable-atomic | 1.15.0 | Apache-2.0 OR MIT | https://github.com/taiki-e/portable-atomic |
| potential_utf | 0.1.6 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| ppv-lite86 | 0.2.21 | MIT OR Apache-2.0 | https://github.com/cryptocorrosion/cryptocorrosion |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 | https://github.com/dtolnay/proc-macro2 |
| quote | 1.0.47 | MIT OR Apache-2.0 | https://github.com/dtolnay/quote |
| rand | 0.10.4 | MIT OR Apache-2.0 | https://github.com/rust-random/rand |
| rand_chacha | 0.10.0 | MIT OR Apache-2.0 | https://github.com/rust-random/rand |
| rand_core | 0.10.1 | MIT OR Apache-2.0 | https://github.com/rust-random/rand_core |
| rayon | 1.12.0 | MIT OR Apache-2.0 | https://github.com/rayon-rs/rayon |
| rayon-core | 1.13.0 | MIT OR Apache-2.0 | https://github.com/rayon-rs/rayon |
| regex | 1.13.2 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex |
| regex-automata | 0.4.19 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex |
| regex-syntax | 0.8.12 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT | https://github.com/rust-lang/rustc-hash |
| rustix | 1.1.6 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | https://github.com/bytecodealliance/rustix |
| same-file | 1.0.6 | Unlicense/MIT | https://github.com/BurntSushi/same-file |
| sed | 0.3.0 | MIT | https://github.com/uutils/sed （flash-sh 源码里的 vendor/sed 补丁版：只把依赖改到 uucore 0.13 / fancy-regex 0.20，库源码只改两处类型参数） |
| self_cell | 1.3.0 | Apache-2.0 OR GPL-2.0-only | https://github.com/Voultapher/self_cell |
| serde | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| sha2 | 0.11.1 | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes |
| sha3 | 0.12.0 | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes |
| smallvec | 1.16.6 | MIT OR Apache-2.0 | https://github.com/smallvec/smallvec |
| sponge-cursor | 0.1.0 | MIT OR Apache-2.0 | https://github.com/RustCrypto/utils |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 | https://github.com/storyyeller/stable_deref_trait |
| strsim | 0.11.1 | MIT | https://github.com/rapidfuzz/strsim-rs |
| syn | 2.0.119 | MIT OR Apache-2.0 | https://github.com/dtolnay/syn |
| syn | 3.0.10 | MIT OR Apache-2.0 | https://github.com/dtolnay/syn |
| synstructure | 0.14.0 | MIT | https://github.com/mystor/synstructure |
| tempfile | 3.27.0 | MIT OR Apache-2.0 | https://github.com/Stebalien/tempfile |
| terminal_size | 0.4.4 | MIT OR Apache-2.0 | https://github.com/eminence/terminal-size |
| thiserror | 2.0.21 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror |
| thiserror-impl | 2.0.21 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror |
| tinystr | 0.8.5 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| type-map | 0.5.1 | MIT/Apache-2.0 | https://github.com/kardeiz/type-map |
| typenum | 1.20.1 | MIT OR Apache-2.0 | https://github.com/paholg/typenum |
| unic-langid | 0.9.6 | MIT OR Apache-2.0 | https://github.com/zbraniecki/unic-locale |
| unic-langid-impl | 0.9.6 | MIT OR Apache-2.0 | https://github.com/zbraniecki/unic-locale |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | https://github.com/dtolnay/unicode-ident |
| unicode-width | 0.2.3 | MIT OR Apache-2.0 | https://github.com/unicode-rs/unicode-width |
| unit-prefix | 0.5.2 | MIT | https://codeberg.org/commons-rs/unit-prefix |
| utf16_iter | 1.1.0 | Apache-2.0 OR MIT | https://github.com/hsivonen/utf16_iter |
| utf8_iter | 1.1.0 | Apache-2.0 OR MIT | https://github.com/hsivonen/utf8_iter |
| utf8parse | 0.2.2 | Apache-2.0 OR MIT | https://github.com/alacritty/vte |
| utf_types | 1.0.0 | Apache-2.0 OR MIT | https://github.com/hsivonen/utf_types |
| uu_base32 | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/base32 |
| uu_base64 | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/base64 |
| uu_basename | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/basename |
| uu_cat | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/cat |
| uu_comm | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/comm |
| uu_cp | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/cp |
| uu_cut | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/cut |
| uu_date | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/date |
| uu_dirname | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/dirname |
| uu_du | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/du |
| uu_env | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/env |
| uu_expr | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/expr |
| uu_fold | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/fold |
| uu_head | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/head |
| uu_join | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/join |
| uu_ln | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/ln |
| uu_ls | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/ls |
| uu_mkdir | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/mkdir |
| uu_mktemp | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/mktemp |
| uu_mv | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/mv |
| uu_nl | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/nl |
| uu_od | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/od |
| uu_paste | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/paste |
| uu_printenv | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/printenv |
| uu_realpath | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/realpath |
| uu_rm | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/rm |
| uu_rmdir | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/rmdir |
| uu_seq | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/seq |
| uu_shuf | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/shuf |
| uu_sleep | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/sleep |
| uu_sort | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/sort |
| uu_split | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/split |
| uu_tac | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/tac |
| uu_tail | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/tail |
| uu_tee | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/tee |
| uu_touch | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/touch |
| uu_tr | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/tr |
| uu_uname | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/uname |
| uu_uniq | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/uniq |
| uu_wc | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/wc |
| uu_whoami | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/whoami |
| uu_yes | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uu/yes |
| uucore | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uucore |
| uucore_procs | 0.13.0 | MIT | https://github.com/uutils/coreutils/tree/main/src/uucore_procs |
| uutils_term_grid | 0.8.1 | MIT | https://github.com/uutils/uutils-term-grid |
| vsimd | 0.8.0 | MIT | https://github.com/Nugine/simd |
| walkdir | 2.5.1 | Unlicense/MIT | https://github.com/BurntSushi/walkdir |
| wild | 2.2.1 | Apache-2.0 OR MIT | https://gitlab.com/kornelski/wild |
| winapi-util | 0.1.11 | Unlicense OR MIT | https://github.com/BurntSushi/winapi-util |
| windows-link | 0.2.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| winnow | 1.0.5 | MIT | https://github.com/winnow-rs/winnow |
| write16 | 1.0.0 | Apache-2.0 OR MIT | https://github.com/hsivonen/write16 |
| writeable | 0.6.4 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| yansi | 1.0.1 | MIT OR Apache-2.0 | https://github.com/SergioBenitez/yansi |
| yoke | 0.8.4 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| yoke-derive | 0.8.4 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| z85 | 3.0.7 | MIT/Apache-2.0 | https://github.com/decafbad/z85 |
| zerocopy | 0.8.64 | BSD-2-Clause OR Apache-2.0 OR MIT | https://github.com/google/zerocopy |
| zerocopy-derive | 0.8.64 | BSD-2-Clause OR Apache-2.0 OR MIT | https://github.com/google/zerocopy |
| zerofrom | 0.1.8 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| zerofrom-derive | 0.1.8 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| zerotrie | 0.2.5 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| zerovec | 0.11.9 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| zerovec-derive | 0.11.7 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
