import { Request, Response } from 'express';
import {
  cloudflareService,
  D1_SCHEMA_SQL,
  CLOUDFLARE_WORKER_SAMPLE_CODE,
} from '../services/CloudflareService';

export class CloudflareController {
  static getConfig(req: Request, res: Response) {
    try {
      const config = cloudflareService.getConfig();
      res.json({
        success: true,
        data: config,
      });
    } catch (err: any) {
      console.error('[CloudflareController] getConfig failed:', err);
      res.status(500).json({ error: 'Gagal membaca konfigurasi Cloudflare' });
    }
  }

  static saveConfig(req: Request, res: Response) {
    try {
      const {
        enabled,
        mode,
        accountId,
        databaseId,
        apiToken,
        workerUrl,
        workerAuthSecret,
        autoSync,
        syncIntervalMinutes,
      } = req.body;

      const rawConfig = cloudflareService.getRawConfig();

      // Only update tokens if provided and not masked
      let finalApiToken = rawConfig.apiToken;
      if (apiToken && !apiToken.includes('••••')) {
        finalApiToken = apiToken.trim();
      }

      let finalWorkerSecret = rawConfig.workerAuthSecret;
      if (workerAuthSecret && !workerAuthSecret.includes('••••')) {
        finalWorkerSecret = workerAuthSecret.trim();
      }

      const updated = cloudflareService.saveConfig({
        enabled: Boolean(enabled),
        mode: mode === 'WORKER' ? 'WORKER' : 'D1_DIRECT',
        accountEmail: (req.body.accountEmail || rawConfig.accountEmail || 'aura.magelang@gmail.com').trim(),
        accountId: (accountId || '').trim(),
        databaseId: (databaseId || '').trim(),
        apiToken: finalApiToken,
        workerUrl: (workerUrl || '').trim(),
        workerAuthSecret: finalWorkerSecret,
        autoSync: Boolean(autoSync),
        syncIntervalMinutes: Number(syncIntervalMinutes) || 5,
      });

      res.json({
        success: true,
        message: 'Konfigurasi Cloudflare berhasil disimpan',
        data: updated,
      });
    } catch (err: any) {
      console.error('[CloudflareController] saveConfig failed:', err);
      res.status(500).json({ error: 'Gagal menyimpan konfigurasi Cloudflare' });
    }
  }

  static async testConnection(req: Request, res: Response) {
    try {
      const result = await cloudflareService.testConnection();
      res.json({
        success: result.success,
        data: result,
      });
    } catch (err: any) {
      console.error('[CloudflareController] testConnection failed:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Gagal menguji koneksi ke Cloudflare',
      });
    }
  }

  static async autoConnect(req: Request, res: Response) {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ error: 'Token API Cloudflare wajib diisi' });
      }
      const result = await cloudflareService.autoConnectWithToken(token);
      res.json(result);
    } catch (err: any) {
      console.error('[CloudflareController] autoConnect failed:', err);
      res.status(400).json({ error: err.message || 'Gagal menyambungkan ke Cloudflare' });
    }
  }

  static async initSchema(req: Request, res: Response) {
    try {
      const result = await cloudflareService.initDatabaseSchema();
      res.json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (err: any) {
      console.error('[CloudflareController] initSchema failed:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Gagal menginisialisasi skema di Cloudflare D1',
      });
    }
  }

  static async getStatus(req: Request, res: Response) {
    try {
      const status = await cloudflareService.getStatus();
      res.json({
        success: true,
        data: status,
      });
    } catch (err: any) {
      console.error('[CloudflareController] getStatus failed:', err);
      res.status(500).json({ error: 'Gagal memeriksa status Cloudflare' });
    }
  }

  static async pushAll(req: Request, res: Response) {
    try {
      const result = await cloudflareService.pushAllLocalData();
      res.json({
        success: true,
        message: 'Semua data peserta, bank soal, hasil, dan relasi berhasil diunggah ke Cloudflare D1!',
        data: result,
      });
    } catch (err: any) {
      console.error('[CloudflareController] pushAll failed:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Gagal menyinkronkan data ke Cloudflare D1',
      });
    }
  }

  static async pullAll(req: Request, res: Response) {
    try {
      const result = await cloudflareService.pullAllRemoteData();
      res.json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (err: any) {
      console.error('[CloudflareController] pullAll failed:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Gagal menarik data dari Cloudflare D1',
      });
    }
  }

  static getSchemaSql(req: Request, res: Response) {
    res.json({
      success: true,
      sql: D1_SCHEMA_SQL.trim(),
    });
  }

  static getWorkerCode(req: Request, res: Response) {
    res.json({
      success: true,
      code: CLOUDFLARE_WORKER_SAMPLE_CODE.trim(),
    });
  }
}
