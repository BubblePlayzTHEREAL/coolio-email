import { NextResponse } from 'next/server';

const MAIL_SERVER = '192.168.0.59';
const SSH_USER = 'root';
const SSH_PASS = '15954Lind';
const DOMAIN = 'ddylongneck.com';

async function sshExec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { spawn } = await import('child_process');
  
  return new Promise((resolve) => {
    const child = spawn('sshpass', ['-p', SSH_PASS, 'ssh', '-o', 'StrictHostKeyChecking=no', `${SSH_USER}@${MAIL_SERVER}`, command], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on('error', (err) => {
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}

async function listAliases(): Promise<Array<{ name: string; email: string; createdAt: string; active: boolean }>> {
  const { stdout } = await sshExec('cat /etc/postfix/virtual');
  
  const aliases: Array<{ name: string; email: string; createdAt: string; active: boolean }> = [];
  
  stdout.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    
    const [alias, target] = trimmed.split(/\s+/);
    if (alias && target && alias.endsWith(`@${DOMAIN}`) && !alias.startsWith('postmaster') && !alias.startsWith('noreply')) {
      const name = alias.replace(`@${DOMAIN}`, '');
      aliases.push({
        name,
        email: target,
        createdAt: new Date().toISOString(),
        active: true,
      });
    }
  });
  
  return aliases;
}

export async function GET() {
  try {
    const aliases = await listAliases();
    return NextResponse.json({ aliases });
  } catch (error) {
    console.error('Failed to list aliases:', error);
    return NextResponse.json({ error: 'Failed to list aliases' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { alias, forwardingTo } = body;

    if (!alias || !forwardingTo) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!/^[a-z0-9-]{3,32}$/.test(alias)) {
      return NextResponse.json({ 
        error: 'Alias must be 3-32 characters, lowercase letters, numbers, and hyphens only' 
      }, { status: 400 });
    }

    const fullAlias = `${alias}@${DOMAIN}`;

    const { stdout: virtualCheck } = await sshExec(`grep -E "^${fullAlias}\\s" /etc/postfix/virtual`);
    if (virtualCheck.trim()) {
      return NextResponse.json({ error: 'Alias already exists' }, { status: 409 });
    }

    // Only add to Postfix virtual (forwarding), no Dovecot user needed
    const virtualEntry = `${fullAlias} ${forwardingTo}`;
    await sshExec(`echo "${virtualEntry}" >> /etc/postfix/virtual && postmap /etc/postfix/virtual`);

    await sshExec('systemctl reload postfix');

    return NextResponse.json({ 
      alias,
      email: forwardingTo,
      message: 'Alias created successfully. Emails will forward to your inbox.'
    });
  } catch (error) {
    console.error('Failed to create alias:', error);
    return NextResponse.json({ error: 'Failed to create alias' }, { status: 500 });
  }
}