import { Request, Response } from 'express';
import { authService } from '../services/AuthService';
import { TokenLoginSchema } from '../dto';

export class AuthController {
  static adminLogin(req: Request, res: Response) {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username dan Password wajib diisi' });
      return;
    }

    const auth = authService.adminLogin(username, password);
    if (!auth) {
      res.status(401).json({ error: 'Kredensial Admin tidak valid' });
      return;
    }

    res.json({
      message: 'Login Admin Berhasil',
      user: auth.user,
      token: auth.token,
    });
  }

  static participantTokenLogin(req: Request, res: Response) {
    const parseResult = TokenLoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Format token tidak valid', details: parseResult.error.format() });
      return;
    }

    const { token, examToken, deviceId, fullName } = parseResult.data;
    const auth = authService.participantLogin(token, examToken, deviceId, fullName);

    if (auth.error) {
      res.status(403).json({ error: auth.error });
      return;
    }

    if (!auth.user || !auth.exam || !auth.token) {
      res.status(404).json({ error: 'Token peserta atau Token Ujian tidak valid/tidak aktif' });
      return;
    }

    res.json({
      message: 'Verifikasi Token Ujian Berhasil',
      user: auth.user,
      exam: auth.exam,
      token: auth.token,
    });
  }
}
