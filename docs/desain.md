# Rancangan Tahap 1 — Sistem Nilai Zero Trust

## Batas kepercayaan dan alur request

```text
Klien -- Bearer user token + X-Device-ID --> Gateway :3000 (PEP + PE/PA)
                                                |-- policy + audit
                                                |-- X-Gateway-Secret + token --> Nilai :3001
                                                `-- X-Gateway-Secret + token --> Transkrip :3002
Nilai -- POST /transkrip/sinkron melalui Gateway (token service) --> Transkrip
```

Gateway adalah satu-satunya pintu masuk. Gateway memverifikasi identitas, device, dan kebijakan per request, mencatat allow/deny, lalu meneruskan request. Service memverifikasi gateway secret dan JWT lagi. Pemeriksaan kepemilikan (kelas dosen/NIM mahasiswa) mengambil fakta dari database, bukan mempercayai klaim klien. Untuk `GET /nilai`, gateway menghitung ID nilai yang berada dalam cakupan user dari database dan meneruskan cakupan tersebut ke Service Nilai.

## Skema data

- `users`: akun dan role (`mahasiswa`, `dosen`, `admin`), hash password.
- `devices`: device ID yang terdaftar untuk user.
- `courses`: kelas dan dosen pengampu.
- `enrollments`: relasi mahasiswa ke kelas.
- `grades`: nilai per mahasiswa-kelas, status final, waktu perubahan.
- `transcripts`: nilai yang telah disinkronkan, unik per mahasiswa-kelas.
- `refresh_tokens`: hash token refresh, kedaluwarsa dan pencabutan.
- `service_clients`: kredensial client service dalam bentuk hash.
- `audit_logs`: keputusan gateway, subjek, endpoint, device, hasil, alasan, waktu.

## Endpoint yang akan dibangun

| Gateway route | Tujuan | Aturan utama |
|---|---|---|
| `POST /auth/login` | Gateway | Kredensial dan device valid |
| `POST /auth/refresh`, `/auth/logout` | Gateway | Refresh token valid dan belum dicabut |
| `POST /auth/service` | Gateway | Client ID/secret Service Nilai valid |
| `GET /nilai` | Nilai | Mahasiswa hanya miliknya; dosen hanya kelasnya |
| `PUT /nilai/:id` | Nilai | Dosen pengampu, belum final, jam akses |
| `POST /kelas/:id/finalisasi` | Nilai | Dosen pengampu, jam akses; lanjut sinkron transkrip |
| `GET /transkrip/:nim` | Transkrip | Mahasiswa hanya NIM sendiri; admin semua |
| `POST /transkrip/sinkron` | Transkrip | Hanya token service |

## Fondasi implementasi

- Database SQLite dibuat dengan `npm run db:init` dan seed dengan `npm run db:seed`.
- Buat `.env` dari `.env.example`, isi secret acak untuk JWT dan gateway, lalu jalankan ulang `npm run db:seed` setelah mengatur `SERVICE_CLIENT_SECRET` agar hash di database sesuai.
- Gateway dijalankan dengan `npm run start:gateway`, Service Nilai dengan `npm run start:nilai`, dan Service Transkrip dengan `npm run start:transkrip`.
- Saat finalisasi, Service Nilai meminta token service dari Gateway, lalu POST sinkronisasi kembali melalui Gateway. Service Transkrip mengambil nilai final dari database dan melakukan upsert ke transkrip.

## Seed awal

1 admin, 2 dosen, 3 mahasiswa; 2 kelas dengan pengampu berbeda; mahasiswa didaftarkan ke kelas; satu device per user. Password seed hanya untuk demonstrasi lokal dan tersedia di README.
