"""Self-contained read-only Linux process probe, piped into remote Python 3."""
import json
import os
import subprocess
import time


def cpu_sample():
    values = {}
    for name in os.listdir('/proc'):
        if not name.isdigit():
            continue
        try:
            with open('/proc/' + name + '/stat') as stream:
                fields = stream.read().rsplit(')', 1)[1].split()
            values[int(name)] = (int(fields[11]) + int(fields[12]), fields[19], time.monotonic())
        except (OSError, ValueError, IndexError):
            pass  # process exited or this login cannot inspect it
    return values


def parse_processes(text, users, before, after, hz):
    rows = []
    for line in text.splitlines():
        fields = line.split(None, 7)
        if len(fields) != 8:
            raise ValueError('Incomplete ps row')
        pid, ppid, uid = map(int, fields[:3])
        cpu = None
        a, b = before.get(pid), after.get(pid)
        if a and b and a[1] == b[1] and b[2] > a[2]:
            cpu = round(max(0, b[0] - a[0]) / hz / (b[2] - a[2]) * 100, 1)
        rows.append(dict(pid=pid, ppid=ppid, uid=uid, username=users.get(uid, '#' + str(uid)),
                         state=fields[3], cpu_percent=cpu, memory_percent=float(fields[4]),
                         rss_bytes=int(fields[5]) * 1024, elapsed_seconds=int(fields[6]),
                         command=fields[7][:2048], command_truncated=len(fields[7]) > 2048))
    return rows


def collect():
    import pwd
    before = cpu_sample()
    time.sleep(0.5)
    result = subprocess.run(['ps', '-e', '-ww', '-o', 'pid=,ppid=,uid=,stat=,pmem=,rss=,etimes=,args='],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
                            errors='replace', timeout=8, env=dict(os.environ, LC_ALL='C'))
    if result.returncode:
        raise RuntimeError('ps failed: ' + result.stderr[:300])
    after = cpu_sample()
    users = {entry.pw_uid: entry.pw_name for entry in pwd.getpwall()}
    rows = parse_processes(result.stdout, users, before, after, os.sysconf('SC_CLK_TCK'))
    return dict(entries=rows, ssh_user=pwd.getpwuid(os.geteuid()).pw_name)


if __name__ == '__main__':
    print(json.dumps(collect()))
