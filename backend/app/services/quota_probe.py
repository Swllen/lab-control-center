"""Read-only quota probe, sent to remote python3 over SSH. No third-party packages."""
import json
import os
import shutil
import subprocess
import xml.etree.ElementTree as ET


def fatal_diagnostics(stderr):
    # quota-tools can warn about vanished tmpfs mount devices while successfully
    # reporting disk quotas. Keep every other diagnostic fatal to avoid partial totals.
    ignored = 'repquota: Cannot stat() mounted device tmpfs: No such file or directory'
    return '\n'.join(line for line in stderr.splitlines() if line.strip() and line.strip() != ignored)


def parse_report(text, users):
    root = ET.fromstring(text)
    if root.tag != 'repquota':
        raise ValueError('Unexpected quota report')
    entries = []
    for report in root.findall('Report'):
        for item in report.findall('Quota'):
            name = item.get('user', '')
            uid = int(name.lstrip('#'))
            block = item.find('blockLimits')
            files = item.find('FileLimits')
            if block is None or files is None:
                raise ValueError('Quota report is missing limits')
            number = lambda node, key: max(0, int(node.get(key, '0') or '0'))
            entries.append(dict(
                uid=uid, username=users.get(uid, name), filesystem=report.get('dev', ''),
                used_bytes=number(block, 'used') * 1024,
                soft_bytes=number(block, 'soft') * 1024, hard_bytes=number(block, 'hard') * 1024,
                grace_expires=number(block, 'grace') or None,
                files_used=number(files, 'used'), files_soft=number(files, 'soft'),
                files_hard=number(files, 'hard'), files_grace_expires=number(files, 'grace') or None,
            ))
    return entries


def collect():
    import pwd
    executable = shutil.which('repquota')
    if not executable:
        executable = next((p for p in ('/usr/sbin/repquota', '/sbin/repquota') if os.access(p, os.X_OK)), None)
    if not executable:
        return dict(state='unavailable', entries=[], message='repquota is not installed. Install quota-tools (quota on Ubuntu/Debian).')
    args = [executable, '-a', '-u', '-n', '-p', '-v', '-O', 'xml']
    users = {p.pw_uid: p.pw_name for p in pwd.getpwall()}
    attempts = [args]
    if os.geteuid() != 0 and shutil.which('sudo'):
        attempts.append(['sudo', '-n'] + args)
    for attempt, command in enumerate(attempts):
        try:
            result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    universal_newlines=True, timeout=12, env=dict(os.environ, LC_ALL='C'))
        except subprocess.TimeoutExpired:
            return dict(state='error', entries=[], message='Quota report timed out; no directory scan was performed.')
        errors = result.stderr.strip()
        if result.returncode == 0 and not fatal_diagnostics(errors):
            try:
                entries = parse_report(result.stdout, users)
            except (ValueError, ET.ParseError):
                # Some quota-tools versions return exit 0 with incomplete XML when
                # unprivileged. Still try the explicitly permitted sudo report.
                if attempt + 1 < len(attempts):
                    continue
                return dict(state='error', entries=[], message='Could not parse the quota report from this server.')
            message = None if entries else 'No user quota records were reported. Check that user quotas are enabled on the intended filesystem.'
            if errors:
                message = (message + ' ' if message else '') + 'Quota-tools skipped a missing tmpfs device; disk quota reports were returned successfully.'
            return dict(state='ready', entries=entries, message=message)
    # Preserve diagnostics rather than representing an inaccessible/partial report as zero usage.
    return dict(state='permission_required' if os.geteuid() != 0 else 'error', entries=[],
                message='Unable to read all user quotas. ' + errors[:800],
                setup_command=' '.join(args))


if __name__ == '__main__':
    print(json.dumps(collect()))
