"""Send exact password bytes through SSH; never print credentials."""
import subprocess
import sys
from pathlib import Path

password = Path(sys.argv[1]).read_text(encoding='utf-8-sig').strip()
subprocess.run([
    'ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=15', '-i', 'C:/Users/samfr/.ssh/homeintel_ed25519',
    'homeintel@159.223.40.68',
    'umask 077; docker run --rm -i caddy:2-alpine caddy hash-password > /opt/homeintel/config/staging-password.hash'
], input=(password + '\n').encode(), check=True)
