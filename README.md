# Praktikum Zero Trust — Sistem Nilai

Implementasi tugas praktikum Zero Trust Security dengan API Gateway sebagai Policy Enforcement Point (PEP), Policy Engine / Policy Administrator (PE/PA), Service Nilai, Service Transkrip, dan satu database SQLite bersama.

## Persyaratan

- Node.js **22.5 atau lebih baru** (aplikasi memakai `node:sqlite` bawaan Node).
- npm.
- Satu komputer; tidak perlu Docker atau frontend.

## Menyiapkan aplikasi

Jalankan perintah dari folder repository:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Buka `.env` dan ganti `JWT_ACCESS_SECRET`, `JWT_SERVICE_SECRET`, dan `GATEWAY_SECRET` dengan secret acak yang berbeda. Atur `SERVICE_CLIENT_SECRET` dengan secret acak yang akan dipakai Service Nilai. Jangan mengubah `SERVICE_CLIENT_ID` dari `nilai-service` kecuali juga mengubah konfigurasi client di kode.

Inisialisasi database dan seed:

```powershell
npm.cmd run db:setup
```

> Jalankan `db:setup` sesudah mengisi `.env`: perintah seed menyimpan hash `SERVICE_CLIENT_SECRET` ke database. Untuk mengulang dari database kosong, hapus `data/zero-trust.db`, lalu jalankan `npm run db:setup` kembali.

## Menjalankan tiga aplikasi

Buka tiga terminal PowerShell di folder repository. Jalankan satu perintah di tiap terminal:

```powershell
npm.cmd run start:gateway
```

```powershell
npm.cmd run start:nilai
```

```powershell
npm.cmd run start:transkrip
```

Gateway menerima request pada `http://localhost:3000`; port service adalah 3001 dan 3002. Akses API aplikasi melalui Gateway.

## Akun dan device seed

Password berikut hanya untuk demonstrasi lokal.

| Role | Username | Password | Device ID | NIM |
|---|---|---|---|---|
| Admin | `admin` | `admin123` | `device-admin` | — |
| Dosen | `dosen1` | `dosen123` | `device-dosen1` | — |
| Dosen | `dosen2` | `dosen123` | `device-dosen2` | — |
| Mahasiswa | `mhs1` | `mhs123` | `device-mhs1` | `227006001` |
| Mahasiswa | `mhs2` | `mhs123` | `device-mhs2` | `227006002` |
| Mahasiswa | `mhs3` | `mhs123` | `device-mhs3` | `227006003` |

Seed membuat kelas `IF101` dengan dosen1 dan `IF202` dengan dosen2. ID kelas SQLite adalah 1 dan 2. Semua mahasiswa terdaftar di kedua kelas; data nilai awal ada untuk demonstrasi.

## Endpoint

Semua endpoint berikut diakses lewat Gateway.

| Method dan path | Fungsi |
|---|---|
| `POST /auth/login` | Login user dengan username, password, dan `X-Device-ID` |
| `POST /auth/refresh` | Rotasi refresh token dan penerbitan access token baru |
| `POST /auth/logout` | Mencabut refresh token |
| `POST /auth/service` | Menerbitkan token service untuk client terdaftar |
| `GET /nilai` | Nilai milik mahasiswa atau kelas yang diampu dosen |
| `PUT /nilai/:id` | Mengubah nilai yang belum final dalam jam akses |
| `POST /kelas/:id/finalisasi` | Finalisasi kelas dan memicu sinkronisasi transkrip melalui Gateway |
| `GET /transkrip/:nim` | Transkrip mahasiswa sendiri atau semua NIM untuk admin |
| `POST /transkrip/sinkron` | Endpoint internal; hanya token service Service Nilai |

Contoh login memakai PowerShell:

```powershell
$login = Invoke-RestMethod -Method Post `
  -Uri http://localhost:3000/auth/login `
  -Headers @{ 'X-Device-ID' = 'device-mhs1' } `
  -ContentType 'application/json' `
  -Body '{"username":"mhs1","password":"mhs123"}'
$token = $login.accessToken
```

Minta nilai dan transkrip dengan token yang sama:

```powershell
Invoke-RestMethod -Uri http://localhost:3000/nilai `
  -Headers @{ Authorization = "Bearer $token"; 'X-Device-ID' = 'device-mhs1' }
Invoke-RestMethod -Uri http://localhost:3000/transkrip/227006001 `
  -Headers @{ Authorization = "Bearer $token"; 'X-Device-ID' = 'device-mhs1' }
```

Untuk menguji deny, coba NIM `227006002` dengan token mhs1 atau pakai device yang tidak terdaftar. Dosen dapat mengubah dan memfinalisasi nilai hanya pada kelas ampuannya dan dalam jam yang ditetapkan oleh `ACCESS_START`, `ACCESS_END`, dan `TIMEZONE` di `.env` (default 07.00–21.00 WIB).

## Penerapan Zero Trust

- **Never trust, always verify:** setiap request ke resource melewati validasi JWT di Gateway dan service; service juga mewajibkan `X-Gateway-Secret`.
- **Least privilege:** PE memeriksa role, kepemilikan data, kelas dosen, status final nilai, dan device terdaftar. Service membatasi data berdasarkan pemilik/kelas dari database.
- **Assume breach:** service menolak request langsung tanpa secret gateway dan token yang sah. Refresh token disimpan dalam bentuk hash dan dapat dicabut; token refresh dirotasi.
- **PEP dan PE/PA:** Gateway menerapkan keputusan allow/deny dari policy module dan mencatat keputusan ke tabel `audit_logs`.
- **Service-to-service:** Service Nilai meminta token 5 menit ke Gateway dan mengirim sinkronisasi Transkrip kembali melalui Gateway.

Audit log mencatat waktu, subjek, endpoint, device (jika user), keputusan, dan alasan.

## Alur video demo (6–9 menit)

1. **0:00–0:50 — Arsitektur:** jelaskan Gateway port 3000 sebagai PEP, dua service, dan database bersama.
2. **0:50–1:40 — Seed dan data:** tunjukkan tabel user/device/kelas/nilai serta akun dan device di README.
3. **1:40–2:40 — Autentikasi:** tunjukkan login, JWT 10 menit, refresh token 1 hari yang dirotasi, logout, dan token service 5 menit.
4. **2:40–4:30 — Kebijakan dan konteks:** demo mahasiswa melihat nilai/transkrip sendiri, akses NIM mahasiswa lain ditolak, device salah ditolak, serta dosen hanya mengubah nilai di kelasnya pada jam konfigurasi.
5. **4:30–5:30 — Perlindungan service:** tunjukkan middleware yang memeriksa gateway secret dan memverifikasi ulang token; jelaskan bahwa token user tidak dapat memanggil endpoint sinkronisasi.
6. **5:30–6:40 — Finalisasi:** finalisasi kelas sebagai dosen pengampu, tunjukkan permintaan token service dari Gateway dan pemanggilan `/transkrip/sinkron` melalui Gateway, lalu cek transkrip mahasiswa.
7. **6:40–7:20 — Audit:** tampilkan isi tabel `audit_logs` untuk keputusan allow dan deny beserta alasannya.

## Struktur kode

- `src/gateway`: autentikasi, penerbitan/verifikasi token, policy engine, audit, dan forwarding.
- `src/services/nilai`: query nilai, perubahan nilai, finalisasi, dan pemanggilan sinkronisasi.
- `src/services/transkrip`: baca transkrip serta sinkronisasi terbatas token service.
- `src/db`: schema SQLite, koneksi, inisialisasi, dan seed.
- `docs/desain.md`: ringkasan arsitektur, skema, dan kebijakan.
