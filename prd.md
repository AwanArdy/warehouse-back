# Product Requirements Document (PRD)
## Sistem Administrasi Kawasan Pergudangan (Warehouse Administration System)

---

## 1. Ringkasan Eksekutif & Visi Produk

**Sistem Administrasi Kawasan Pergudangan** adalah platform perangkat lunak terpusat yang dirancang untuk mengelola seluruh siklus administrasi keluar-masuk armada angkutan, aktivitas bongkar muat (*loading/unloading*), pencatatan inventori gudang, serta penerbitan dokumen legal dan operasional persuratan secara otomatis.

Sistem ini dibangun dengan paradigma **Backend-First** menggunakan **TypeScript** dan **PostgreSQL Raw Query**. Seluruh validasi aturan bisnis armada, integritas transaksi basis data, keamanan antrean, dan mesin kompilasi dokumen berbasis **LaTeX** dibangun dan diuji secara menyeluruh di sisi *server* sebelum pengembangan antarmuka pengguna (*frontend*) dimulai.

---

## 2. Tujuan Produk & Ruang Lingkup

### 2.1 Tujuan Utama
1. **Penegakan Aturan Armada yang Ketat:** Memisahkan secara sistem alur angkutan barang/kargo umum (khusus **Mobil Box**) dan angkutan kontainer (khusus **Trailer** dan **Tronton**) guna mencegah kesalahan alokasi *loading dock* dan pelanggaran SOP kawasan.
2. **Otomatisasi Persuratan Presisi Tinggi:** Menghasilkan dokumen resmi berstandar cetak tinggi (Surat Jalan, *Gate Pass*, Berita Acara Serah Terima Barang/BASTB, dan Rekapitulasi Harian) menggunakan mesin kompilasi **LaTeX** (bukan konversi HTML ke PDF).
3. **Integritas Data & Auditabilitas Penuh:** Menjamin setiap pergerakan kendaraan, mutasi stok barang, hingga penerbitan dan pembatalan surat tercatat secara atomik dan dapat diaudit.
4. **Kesiapan Integrasi (API-First Contract):** Menyediakan kontrak REST API yang terstandarisasi dan terdokumentasi sehingga siap dikonsumsi oleh aplikasi web admin, pos gerbang (*gate*), maupun sistem eksternal di masa mendatang.

### 2.2 Ruang Lingkup Sistem (In-Scope)
* Manajemen master data kawasan pergudangan, *loading dock*, master kendaraan, pengemudi, dan katalog barang.
* Pencatatan operasional pos gerbang (*Gate-In* dan *Gate-Out*) serta pemantauan status antrean kendaraan di dalam kawasan.
* Pencatatan realisasi bongkar (*Inbound*) dan muat (*Outbound*) yang terhubung langsung dengan buku besar inventori gudang.
* Mesin kompilasi dokumen PDF berbasis LaTeX secara asinkron beserta fitur verifikasi QR Code dan manajemen revisi/pembatalan surat (`VOID`).

---

## 3. User Personas & Matriks Hak Akses (RBAC)

| Role | Deskripsi Peran | Tanggung Jawab & Hak Akses Utama |
| :--- | :--- | :--- |
| **Super Admin** | Kepala Operasional / Administrator Sistem | Mengelola akun pengguna dan *role*, konfigurasi master gudang, *loading dock*, pemantauan *audit log*, serta akses penuh ke seluruh laporan dan dokumen. |
| **Petugas Gate (Security)** | Petugas Pos Gerbang Masuk & Keluar | Mendaftarkan kendaraan baru, mencatat *Gate-In*, memverifikasi fisik jenis armada (Mobil Box vs Trailer/Tronton), memverifikasi nomor kontainer & segel, mencetak *Gate Pass*, dan memproses *Gate-Out*. |
| **Admin Operasional Gudang** | Staf Administrasi Lapangan Gudang | Mengalokasikan kendaraan ke *loading dock*, mencatat rincian barang bongkar/muat, memvalidasi selisih barang, dan mengajukan penerbitan BASTB atau Surat Jalan. |
| **Admin Persuratan** | Staf Administrasi Dokumen & Legal | Memverifikasi kelengkapan manifest, memicu kompilasi ulang dokumen LaTeX jika terjadi galat, menerbitkan dokumen revisi, dan membatalkan (`VOID`) dokumen yang keliru. |

---

## 4. Aturan Bisnis & Spesifikasi Armada (Domain Rules)

Sistem wajib menerapkan aturan bisnis berikut sebagai validasi keras (*hard constraints*):

### 4.1 Klasifikasi Angkutan & Kendaraan
1. **Kategori Angkutan Barang / Kargo Umum (`CARGO`):**
   * **Jenis Kendaraan yang Diizinkan:** Hanya **Mobil Box** (`MOBIL_BOX`).
   * **Aturan Penolakan:** Kendaraan selain Mobil Box (seperti truk bak terbuka, *pick-up* bak terbuka, kendaraan pribadi, atau sepeda motor) **wajib ditolak** oleh sistem saat pendaftaran transaksi kargo umum.
   * **Aturan Atribut:** Transaksi kategori `CARGO` dilarang memiliki data nomor kontainer maupun nomor segel kontainer.

2. **Kategori Angkutan Kontainer (`CONTAINER`):**
   * **Jenis Kendaraan yang Diizinkan:** Hanya **Trailer** (`TRAILER`) dan **Tronton** (`TRONTON`).
   * **Aturan Penolakan:** Mobil Box tidak diperbolehkan mengambil transaksi kategori kontainer.
   * **Aturan Atribut Wajib:** Setiap transaksi kategori `CONTAINER` wajib melampirkan:
     * Nomor kontainer sesuai standar ISO 6346 (4 huruf kapital diikuti 7 digit angka, contoh: `MSCU1234567`).
     * Ukuran kontainer (`20FT`, `40FT`, atau `40HC`).
     * Nomor segel (*seal number*) fisik kontainer.
     * Status muatan kontainer (`FULL` atau `EMPTY`).

### 4.2 Aturan Operasional Gerbang & Dock
1. **Pencegahan Duplikasi Kunjungan:** Satu kendaraan (berdasarkan nomor polisi) tidak dapat melakukan *Gate-In* baru apabila masih memiliki transaksi aktif di dalam kawasan pergudangan (status belum `GATE_OUT` atau `CANCELLED`).
2. **Kesesuaian Loading Dock:** Kendaraan kategori `CARGO` hanya dapat ditempatkan pada *loading dock* bertipe `CARGO`, dan kendaraan kategori `CONTAINER` hanya dapat ditempatkan pada *loading dock* bertipe `CONTAINER`.
3. **Syarat Mutlak Gate-Out:** Petugas Gate tidak dapat menyelesaikan proses *Gate-Out* apabila:
   * Aktivitas bongkar muat belum diselesaikan oleh Admin Gudang.
   * Dokumen persuratan wajib belum berstatus `ISSUED` (wajib ada `BASTB` untuk transaksi `INBOUND`, atau wajib ada `SURAT_JALAN` untuk transaksi `OUTBOUND`).

### 4.3 Aturan Persuratan LaTeX
1. **Immutability (Kekekalan Dokumen):** Dokumen PDF yang telah berstatus `ISSUED` bersifat final dan tidak dapat disunting.
2. **Mekanisme Pembatalan & Revisi:** Jika ditemukan kesalahan pada dokumen `ISSUED`, Admin Persuratan wajib mengubah status dokumen lama menjadi `VOID` (dengan menyertakan alasan pembatalan) sebelum sistem mengizinkan penerbitan dokumen baru sebagai pengganti.
3. **Penomoran Atomik:** Nomor surat di-generate secara berurutan per jenis dokumen, kode gudang, tahun, dan bulan tanpa celah maupun duplikasi.

---

## 5. Functional Requirements (FR)

### Modul A: Manajemen Master Data & Armada
* **FR-A1:** Sistem menyediakan pengelolaan data master gudang (kode gudang, nama, kapasitas volume/tonase maksimal) dan daftar *loading dock* (nomor dock, kategori layanan `CARGO`/`CONTAINER`, status `AVAILABLE`/`OCCUPIED`/`MAINTENANCE`).
* **FR-A2:** Sistem menyediakan pendaftaran master kendaraan dengan validasi kombinasi kategori dan tipe armada (`CARGO` $\leftrightarrow$ `MOBIL_BOX`; `CONTAINER` $\leftrightarrow$ `TRAILER`/`TRONTON`).
* **FR-A3:** Sistem menyediakan pencarian cepat master kendaraan berdasarkan nomor polisi saat armada tiba di gerbang.

### Modul B: Manajemen Pos Gate & Antrean Dock
* **FR-B1:** Petugas Gate dapat mencatat kedatangan kendaraan (*Gate-In*) dengan memilih arah pergerakan (`INBOUND` untuk bongkar barang ke gudang, `OUTBOUND` untuk muat barang dari gudang).
* **FR-B2:** Sistem secara otomatis mewajibkan input metadata kontainer saat armada `TRAILER` atau `TRONTON` melakukan *Gate-In*.
* **FR-B3:** Admin Gudang dapat melihat antrean kendaraan yang berstatus `GATE_IN` dan menugaskannya ke *loading dock* yang tersedia (`AVAILABLE`).
* **FR-B4:** Petugas Gate dapat memproses *Gate-Out* setelah seluruh syarat dokumen terpenuhi, yang secara otomatis membebaskan status *loading dock* terkait menjadi `AVAILABLE`.

### Modul C: Pencatatan Bongkar Muat & Inventori Gudang
* **FR-C1:** Admin Gudang dapat mencatat daftar rincian barang (*itemized cargo*) yang dibongkar dari Mobil Box maupun Kontainer (Trailer/Tronton) untuk transaksi `INBOUND`.
* **FR-C2:** Admin Gudang dapat mencatat daftar rincian barang yang diambil dari stok gudang untuk dimuat ke Mobil Box maupun Kontainer pada transaksi `OUTBOUND`, dengan validasi ketersediaan stok secara *real-time*.
* **FR-C3:** Sistem menghitung persentase utilisasi kapasitas gudang secara otomatis menggunakan rumus:
  $$U_{\text{gudang}} = \frac{\sum_{i=1}^{n} (Q_i \cdot v_i)}{V_{\text{maks}}} \times 100\%$$
  di mana $Q_i$ menyatakan kuantitas stok item ke-$i$, $v_i$ menyatakan volume satuan item ke-$i$, dan $V_{\text{maks}}$ menyatakan kapasitas volume maksimal gudang.

### Modul D: Modul Persuratan Otomatis Berbasis LaTeX
* **FR-D1:** Sistem mendukung kompilasi 4 jenis dokumen resmi dalam format PDF dari template `.tex`:
  1. **Gate Pass (`GATE_PASS`):** Bukti registrasi masuk kawasan dan tiket antrean *loading dock*.
  2. **Berita Acara Serah Terima Barang (`BASTB`):** Bukti resmi penyelesaian bongkar barang *Inbound* dari armada ke gudang.
  3. **Surat Jalan & Manifest (`SURAT_JALAN`):** Dokumen resmi pengeluaran barang *Outbound* yang memuat identitas armada (Mobil Box atau Trailer/Tronton beserta nomor kontainer & segel).
  4. **Rekapitulasi Administrasi Harian (`REKAP_HARIAN`):** Laporan harian keluar-masuk armada dan total tonase bongkar muat.
* **FR-D2:** Setiap dokumen PDF yang dihasilkan wajib memuat QR Code unik untuk verifikasi keaslian dokumen dan *checksum* SHA-256 yang tersimpan di database.

---

## 6. Non-Functional Requirements (NFR)

1. **Keamanan Basis Data (NFR-01):** Seluruh kueri PostgreSQL wajib ditulis menggunakan *parameterized raw queries* (`$1, $2, ...`) untuk menghilangkan risiko *SQL Injection*.
2. **Keamanan Kompilasi LaTeX (NFR-02):** Seluruh data dinamis yang disuntikkan ke file `.tex` wajib melewati fungsi sanitasi karakter khusus LaTeX (`escapeLatex`), dan proses kompilasi dijalankan menggunakan `xelatex -no-shell-escape` di dalam direktori temporer terisolasi untuk mencegah *LaTeX Injection* dan *Remote Code Execution (RCE)*.
3. **Konsistensi Transaksional (NFR-03):** Perubahan status gate, mutasi stok gudang, dan pengambilan nomor urut surat wajib berjalan di dalam blok transaksi ACID PostgreSQL (`BEGIN ... COMMIT / ROLLBACK`).
4. **Performa & Responsivitas (NFR-04):** Waktu respons endpoint API operasional standar $\le 150\text{ ms}$ pada persentil ke-95 ($P_{95}$), dan proses kompilasi dokumen PDF LaTeX di *background worker* selesai dalam waktu $\le 3\text{ detik}$ per dokumen.

---

## 7. Alur Operasional Pengguna (User Flows)

### 7.1 Alur Inbound (Bongkar Barang ke Gudang)
1. **Kedatangan Armada:** Armada (Mobil Box atau Trailer/Tronton bermuatan kontainer) tiba di gerbang masuk.
2. **Gate-In:** Petugas Gate memverifikasi nomor polisi, jenis armada, identitas pengemudi, serta nomor kontainer & segel (khusus Trailer/Tronton). Sistem menerbitkan tiket transaksi dan memasukkan **Gate Pass** ke antrean kompilasi LaTeX.
3. **Penugasan Dock:** Admin Gudang mengalokasikan kendaraan ke *loading dock* yang sesuai (`CARGO` atau `CONTAINER`). Status berubah menjadi `DOCKING`.
4. **Realisasi Bongkar:** Petugas lapangan membongkar muatan. Admin Gudang menginput rincian barang ke sistem dan melakukan finalisasi bongkar. Stok gudang bertambah secara atomik.
5. **Penerbitan BASTB:** Sistem mengantrekan kompilasi dokumen **BASTB** ke *worker* LaTeX. Setelah PDF selesai dikompilasi, status dokumen menjadi `ISSUED`.
6. **Gate-Out:** Armada menuju gerbang keluar. Petugas Gate memverifikasi status dokumen `ISSUED` dan menyelesaikan proses *Gate-Out*.

### 7.2 Alur Outbound (Muat Barang dari Gudang)
1. **Gate-In:** Armada kosong (Mobil Box atau Trailer/Tronton dengan kontainer kosong) masuk melalui gerbang dan dicatat oleh Petugas Gate.
2. **Penugasan Dock & Rencana Muat:** Admin Gudang menempatkan armada di *loading dock* dan menginput daftar barang yang akan dimuat. Sistem mengunci dan mengurangi stok gudang setelah validasi ketersediaan berhasil.
3. **Penerbitan Surat Jalan:** Admin Persuratan/Gudang memicu pembuatan **Surat Jalan**. *Worker* LaTeX mengompilasi file `.tex` menjadi PDF lengkap dengan rincian barang, nomor kontainer, dan nomor segel baru.
4. **Gate-Out:** Setelah Surat Jalan berstatus `ISSUED` dan dicetak/diserahkan kepada pengemudi, Petugas Gate mengizinkan armada keluar kawasan.

---

## 8. Rencana Pengembangan Granular (Backend-First Milestone Roadmap)

Pengembangan proyek disusun secara sangat terperinci menggunakan pendekatan **Backend-First** dan berbasis **Milestone** (berfokus pada pencapaian target teknis dan kriteria kelulusan tanpa terikat estimasi waktu kalender).

### Milestone 0: Inisiasi Proyek, Fondasi TypeScript, & Infrastruktur Lokal
**Target:** Menyiapkan struktur proyek *backend*, standar penulisan kode ketat, serta lingkungan kontainer untuk PostgreSQL, MinIO, dan TeX Live.
* **M0.1:** Inisialisasi proyek Node.js dengan TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`), ESLint, dan Prettier.
* **M0.2:** Penyusunan struktur direktori arsitektur berlapis (`config`, `db`, `repositories`, `services`, `controllers`, `latex`, `workers`, `validators`, `utils`).
* **M0.3:** Penyusunan `docker-compose.yml` yang berisi layanan PostgreSQL 16+, MinIO (penyimpanan file PDF), dan *container* aplikasi dengan instalasi `texlive-xetex` dan paket pendukung (`qrcode`, `longtable`, `tabularx`, `fancyhdr`).
* **M0.4:** Implementasi validasi *environment variables* saat *startup* aplikasi (*fail-fast configuration*).
* **M0.5:** Pembuatan modul koneksi `pg.Pool` dan pembungkus transaksi eksplisit (`withTransaction(callback)`).
* **Exit Criteria:** Server berjalan tanpa galat, terhubung ke PostgreSQL dan MinIO, serta binary `xelatex` dapat dieksekusi dari proses Node.js.

### Milestone 1: Desain Basis Data & Migrasi SQL Murni (ERD Implementation)
**Target:** Mengimplementasikan seluruh struktur tabel relasional, *constraints*, dan *indexes* di PostgreSQL menggunakan file migrasi SQL murni.
* **M1.1:** Konfigurasi perkakas migrasi berbasis SQL murni (`dbmate` / `node-pg-migrate`).
* **M1.2:** Pembuatan migrasi tabel autentikasi & otorisasi (`users`, `roles`, `permissions`, `user_roles`, `role_permissions`) beserta *seed data* role awal.
* **M1.3:** Pembuatan migrasi tabel master kawasan (`warehouses`, `loading_docks`) dan master barang (`items_master`).
* **M1.4:** Pembuatan migrasi tabel armada (`vehicles`, `drivers`) lengkap dengan `CHECK CONSTRAINT` pemisahan `CARGO` (`MOBIL_BOX`) dan `CONTAINER` (`TRAILER`, `TRONTON`).
* **M1.5:** Pembuatan migrasi tabel operasional gate (`gate_transactions`, `transaction_containers` dengan validasi regex ISO 6346, `transaction_cargo_items`, `gate_status_logs`).
* **M1.6:** Pembuatan migrasi tabel inventori (`warehouse_stocks`, `stock_movements`).
* **M1.7:** Pembuatan migrasi tabel persuratan & audit (`document_sequences`, `official_documents`, `audit_logs`).
* **Exit Criteria:** Seluruh skrip migrasi `up` dan `down` berhasil dijalankan berulang kali dengan bersih, dan pengujian constraint SQL terbukti menolak tipe kendaraan yang tidak sesuai kategori.

### Milestone 2: Lapisan Repository (Raw Query) & Sistem Autentikasi/RBAC
**Target:** Membangun fondasi akses data berbasis *raw query* terparameterisasi dan sistem keamanan API berbasis JWT dan RBAC.
* **M2.1:** Pembuatan *PostgreSQL Error Mapper* untuk menerjemahkan kode galat native PostgreSQL (`23505`, `23503`, `23514`, `40001`) menjadi pengecualian aplikasi yang terstruktur.
* **M2.2:** Implementasi `UserRepository` dan `RoleRepository` menggunakan *raw query* dan pemetaan tipe eksplisit (*explicit row mappers*).
* **M2.3:** Implementasi layanan *hashing* kata sandi (Argon2id) serta penerbitan dan rotasi JWT (*Access Token* & *Refresh Token*).
* **M2.4:** Pembuatan *middleware* autentikasi dan *guard* otorisasi berbasis hak akses (`requirePermission`).
* **M2.5:** Implementasi `AuditLogRepository` untuk mencatat jejak audit setiap perubahan data penting.
* **Exit Criteria:** Pengujian API autentikasi berhasil; akses ke endpoint terproteksi ditolak (`401`/`403`) jika kredensial atau hak akses tidak valid.

### Milestone 3: Core Backend — Master Armada & Siklus Operasional Gate
**Target:** Menyelesaikan seluruh logika bisnis manajemen kendaraan dan pergerakan armada di gerbang serta *loading dock*.
* **M3.1:** Implementasi `VehicleRepository` & `VehicleService` dengan validasi skema HTTP (Zod) dan validasi database untuk **Mobil Box**, **Trailer**, dan **Tronton**.
* **M3.2:** Implementasi `WarehouseDockRepository` & `WarehouseDockService` untuk manajemen ketersediaan *loading dock*.
* **M3.3:** Implementasi `GateTransactionRepository` menggunakan kueri SQL relasional (`JOIN` multi-tabel dan paginasi *cursor/offset*).
* **M3.4:** Implementasi `GateService.processGateIn` (validasi kendaraan tidak sedang berada di dalam kawasan, validasi wajib data kontainer untuk Trailer/Tronton, dan penolakan data kontainer untuk Mobil Box).
* **M3.5:** Implementasi `GateService.assignDock` (validasi kecocokan kategori dock dan penguncian status dock menjadi `OCCUPIED`).
* **M3.6:** Implementasi `GateService.processGateOut` (validasi dokumen wajib berstatus `ISSUED`, pencatatan riwayat status di `gate_status_logs`, dan pembebasan *loading dock*).
* **Exit Criteria:** Seluruh alur *Gate-In* $\rightarrow$ *Assign Dock* $\rightarrow$ *Gate-Out* berfungsi penuh melalui REST API untuk skenario Mobil Box maupun Trailer/Tronton.

### Milestone 4: Core Backend — Bongkar Muat & Buku Besar Inventori
**Target:** Mengintegrasikan pencatatan muatan armada dengan mutasi stok gudang secara atomik dan bebas dari *race condition*.
* **M4.1:** Implementasi `CargoItemRepository` untuk pengelolaan rincian barang pada setiap transaksi gate.
* **M4.2:** Implementasi `InventoryRepository` dengan mekanisme penguncian baris (`SELECT ... FOR UPDATE`) pada tabel `warehouse_stocks`.
* **M4.3:** Implementasi `CargoService.finalizeInboundUnloading` (penambahan stok, pencatatan mutasi `IN` di `stock_movements`, dan transisi status gate ke `DOC_PENDING`).
* **M4.4:** Implementasi `CargoService.finalizeOutboundLoading` (validasi kecukupan stok, pengurangan stok, pencatatan mutasi `OUT` di `stock_movements`, dan transisi status gate ke `DOC_PENDING`).
* **M4.5:** Pembuatan endpoint pelaporan stok terkini dan kalkulasi utilisasi kapasitas gudang.
* **Exit Criteria:** Pengujian konkurensi membuktikan tidak ada stok minus saat beberapa transaksi *Outbound* memproses item yang sama secara bersamaan.

### Milestone 5: Mesin Persuratan LaTeX & Background Compiler Worker
**Target:** Membangun sistem pembuat dokumen PDF resmi berbasis LaTeX yang aman, terisolasi, dan andal.
* **M5.1:** Pembuatan modul `LatexSanitizer` dan *unit test* komprehensif untuk menguji *escaping* seluruh karakter khusus LaTeX serta blokir injeksi makro berbahaya.
* **M5.2:** Perancangan file template `.tex` standar produksi (`gate_pass.tex`, `bastb.tex`, `surat_jalan.tex`, `rekap_harian.tex`) dengan dukungan tabel multi-halaman (`longtable`) dan QR Code verifikasi.
* **M5.3:** Implementasi generator nomor surat atomik menggunakan tabel `document_sequences` di PostgreSQL.
* **M5.4:** Implementasi `LatexCompilerWorker` menggunakan antrean native PostgreSQL (`FOR UPDATE SKIP LOCKED`), eksekusi `xelatex` di direktori sementara terisolasi, perhitungan SHA-256, dan unggah ke MinIO.
* **M5.5:** Implementasi mekanisme *retry* otomatis untuk kegagalan sementara serta fitur pembatalan dokumen (`VOID`) dan penerbitan dokumen revisi.
* **Exit Criteria:** Sistem berhasil mengompilasi data transaksi nyata menjadi dokumen PDF multi-halaman yang rapi dan dapat diunduh melalui API.

### Milestone 6: API Hardening, OpenAPI Spec, & End-to-End Backend Testing
**Target:** Menyempurnakan kesiapan *backend* sebelum pengembangan antarmuka pengguna dimulai.
* **M6.1:** Pembuatan dokumentasi kontrak API lengkap menggunakan OpenAPI 3.1 (Swagger UI).
* **M6.2:** Penerapan *rate limiting*, konfigurasi CORS, *security headers*, dan standarisasi format respons galat JSON.
* **M6.3:** Penulisan *Integration Test Suite* otomatis yang menguji seluruh skenario positif dan negatif (termasuk upaya pendaftaran truk bak terbuka untuk kargo, upaya *Gate-Out* tanpa surat terbit, dan uji *LaTeX injection*).
* **Exit Criteria:** Seluruh *integration test* lulus 100% dan spesifikasi OpenAPI siap dijadikan acuan pembuatan *client* frontend.

### Milestone 7: Inisiasi Frontend TypeScript & Integrasi Kontrak API
**Target:** Membangun fondasi aplikasi web *frontend* yang terhubung secara *type-safe* dengan *backend*.
* **M7.1:** Inisialisasi proyek *frontend* (React / Next.js + TypeScript) dan generasi otomatis tipe data klien API dari dokumen OpenAPI.
* **M7.2:** Implementasi *HTTP client* terpusat dengan *interceptor* token JWT dan penanganan galat terstandarisasi.
* **M7.3:** Implementasi halaman Login, manajemen sesi, dan pengaturan visibilitas menu berdasarkan hak akses RBAC pengguna.
* **M7.4:** Pembuatan komponen antarmuka dasar (Layout utama, Tabel paginasi *server-side*, Form validasi skema, dan Notifikasi status).
* **Exit Criteria:** Pengguna dapat masuk sesuai *role* masing-masing dan mengakses halaman kerangka operasional yang terhubung ke *backend*.

### Milestone 8: Antarmuka Operasional Lapangan & Pusat Persuratan PDF
**Target:** Menyediakan antarmuka pengguna lengkap untuk Petugas Gate, Admin Gudang, dan Admin Persuratan.
* **M8.1:** Pembuatan **Modul Pos Gate**: Form cepat *Gate-In* dinamis (menampilkan bidang input kontainer & segel hanya jika memilih Trailer/Tronton), daftar antrean kendaraan aktif, dan aksi *Gate-Out*.
* **M8.2:** Pembuatan **Papan Status Loading Dock**: Visualisasi ketersediaan *dock* gudang dan penugasan armada ke *dock*.
* **M8.3:** Pembuatan **Modul Bongkar Muat & Inventori**: Form pencatatan item barang masuk/keluar dan indikator utilisasi kapasitas gudang.
* **M8.4:** Pembuatan **Pusat Persuratan & Pratinjau PDF**: Pemicu kompilasi surat LaTeX, pemantauan status kompilasi, penampil PDF langsung di browser, serta fitur pembatalan/revisi surat.
* **Exit Criteria:** Seluruh proses operasional dari gerbang hingga pencetakan dokumen PDF LaTeX dapat dijalankan sepenuhnya melalui antarmuka web.

### Milestone 9: User Acceptance Testing (UAT), Audit Keamanan, & Production Release
**Target:** Memvalidasi kelayakan sistem bersama pengguna lapangan dan meluncurkan aplikasi ke lingkungan produksi.
* **M9.1:** Pelaksanaan simulasi operasional (*User Acceptance Testing*) bersama Petugas Gate, Admin Gudang, dan Admin Persuratan.
* **M9.2:** Kalibrasi tata letak template `.tex` (margin, ukuran font, ruang tanda tangan/stempel) berdasarkan hasil cetak fisik dokumen di printer operasional gudang.
* **M9.3:** Audit keamanan akhir (verifikasi isolasi *worker* LaTeX, rotasi kunci rahasia, dan uji pemulihan *backup* PostgreSQL).
* **M9.4:** Konfigurasi *deployment* produksi, *health check monitoring* (API, Database, LaTeX Worker, MinIO), dan penjadwalan *backup* otomatis.
* **Exit Criteria:** Dokumen UAT disetujui oleh pemangku kepentingan dan sistem beroperasi stabil di lingkungan produksi.