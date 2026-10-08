"""Remote metrics probe.

This file is NOT imported by the backend. Its source is piped over SSH into ``python3 -u -``
on each lab server. It must stay self-contained and compatible with Python >= 3.6 with no
third-party dependencies (``pynvml`` is used opportunistically when installed).

Protocol (one JSON object per line on stdout):
    {"type": "static", ...}   once at start-up (host + GPU inventory)
    {"type": "sample", ...}   every INTERVAL seconds

Usage: python3 -u - [INTERVAL]        (stream mode)
       python3 -u - --test           (print static info + capabilities once, then exit)
"""

import json
import os
import platform
import socket
import subprocess
import sys
import time

REAL_FS = {
    "ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "f2fs", "jfs", "reiserfs",
    "nfs", "nfs4", "cifs", "smb3", "lustre", "gpfs", "beegfs", "ceph", "fuse.glusterfs",
}
SKIP_MOUNT_PREFIXES = ("/snap", "/boot", "/var/lib/docker", "/run", "/var/snap")
VIRTUAL_NIC_PREFIXES = ("lo", "veth", "docker", "br-", "virbr", "cni", "flannel", "cali", "vxlan", "tailscale")


def read(path, default=""):
    try:
        with open(path) as f:
            return f.read()
    except Exception:
        return default


def run(cmd, timeout=5):
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True)
        out, _ = p.communicate(timeout=timeout)
        return out if p.returncode == 0 else ""
    except Exception:
        return ""


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- host / cpu / memory


def os_name():
    fields = {}
    for line in read("/etc/os-release").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            fields[k] = v.strip().strip('"')
    return fields.get("PRETTY_NAME") or fields.get("NAME") or platform.system()


def cpu_inventory():
    model, cores = "", set()
    phys = core = None
    for line in read("/proc/cpuinfo").splitlines():
        if ":" not in line:
            if phys is not None and core is not None:
                cores.add((phys, core))
            phys = core = None
            continue
        k, v = [s.strip() for s in line.split(":", 1)]
        if k == "model name" and not model:
            model = v
        elif k == "physical id":
            phys = v
        elif k == "core id":
            core = v
    if phys is not None and core is not None:
        cores.add((phys, core))
    threads = os.cpu_count() or 0
    return model or platform.processor(), len(cores) or threads, threads


def cpu_times():
    out = {}
    for line in read("/proc/stat").splitlines():
        if not line.startswith("cpu"):
            break
        parts = line.split()
        vals = [int(x) for x in parts[1:]]
        idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
        # guest/guest_nice are already included in user/nice
        total = sum(vals[:8]) if len(vals) >= 8 else sum(vals)
        out[parts[0]] = (idle, total)
    return out


def cpu_percent(prev, cur):
    def pct(name):
        if name not in prev or name not in cur:
            return 0.0
        didle = cur[name][0] - prev[name][0]
        dtotal = cur[name][1] - prev[name][1]
        return round(100.0 * (1.0 - didle / dtotal), 1) if dtotal > 0 else 0.0

    per_core = [pct(n) for n in sorted((k for k in cur if k != "cpu"), key=lambda s: int(s[3:]))]
    return pct("cpu"), per_core


def meminfo():
    m = {}
    for line in read("/proc/meminfo").splitlines():
        parts = line.split()
        if len(parts) >= 2:
            m[parts[0].rstrip(":")] = int(parts[1]) * 1024
    total = m.get("MemTotal", 0)
    avail = m.get("MemAvailable", m.get("MemFree", 0) + m.get("Cached", 0))
    used = max(total - avail, 0)
    return {
        "total": total,
        "used": used,
        "available": avail,
        "percent": round(100.0 * used / total, 1) if total else 0.0,
        "swap_total": m.get("SwapTotal", 0),
        "swap_used": max(m.get("SwapTotal", 0) - m.get("SwapFree", 0), 0),
    }


def uptime_s():
    try:
        return float(read("/proc/uptime", "0").split()[0])
    except Exception:
        return 0.0


# ---------------------------------------------------------------- disks / network


def disks():
    seen = {}
    for line in read("/proc/mounts").splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        device, mount, fstype = parts[0], parts[1].replace("\\040", " "), parts[2]
        if fstype not in REAL_FS or mount.startswith(SKIP_MOUNT_PREFIXES):
            continue
        try:
            st = os.statvfs(mount)
        except OSError:
            continue
        total = st.f_blocks * st.f_frsize
        if total == 0:
            continue
        used = (st.f_blocks - st.f_bfree) * st.f_frsize
        avail = st.f_bavail * st.f_frsize
        entry = {
            "mount": mount,
            "device": device,
            "fstype": fstype,
            "total": total,
            "used": used,
            "percent": round(100.0 * used / (used + avail), 1) if used + avail else 0.0,
        }
        # Same device mounted multiple times (bind mounts): keep the shortest mount point.
        if device not in seen or len(mount) < len(seen[device]["mount"]):
            seen[device] = entry
    return sorted(seen.values(), key=lambda d: d["mount"])


def is_physical_nic(name):
    return not name.startswith(VIRTUAL_NIC_PREFIXES)


def net_counters():
    out = {}
    for line in read("/proc/net/dev").splitlines()[2:]:
        if ":" not in line:
            continue
        name, data = line.split(":", 1)
        name = name.strip()
        if not is_physical_nic(name):
            continue
        f = data.split()
        out[name] = (int(f[0]), int(f[8]))
    return out


def net_static():
    addrs = {}
    for line in run(["ip", "-o", "addr", "show"]).splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[2] in ("inet", "inet6") and "scope" in parts:
            if parts[parts.index("scope") + 1] == "global":
                addrs.setdefault(parts[1], []).append(parts[3])
    out = []
    for name in sorted(net_counters()):
        speed = to_float(read("/sys/class/net/%s/speed" % name).strip())
        out.append({
            "name": name,
            "addresses": addrs.get(name, []),
            "mac": read("/sys/class/net/%s/address" % name).strip(),
            "speed_mbps": int(speed) if speed and speed > 0 else None,
        })
    return out


# ---------------------------------------------------------------- GPUs


class NvmlGpus(object):
    backend = "pynvml"

    def __init__(self):
        import pynvml  # noqa: F401  (raises ImportError when unavailable)

        self.nv = pynvml
        pynvml.nvmlInit()
        self.handles = [pynvml.nvmlDeviceGetHandleByIndex(i) for i in range(pynvml.nvmlDeviceGetCount())]

    @staticmethod
    def _s(v):
        return v.decode() if isinstance(v, bytes) else str(v)

    def _try(self, fn, *args):
        try:
            return fn(*args)
        except Exception:
            return None

    def static(self):
        nv = self.nv
        cuda = self._try(nv.nvmlSystemGetCudaDriverVersion_v2) or self._try(nv.nvmlSystemGetCudaDriverVersion)
        gpus = []
        for i, h in enumerate(self.handles):
            mem = self._try(nv.nvmlDeviceGetMemoryInfo, h)
            limit = self._try(nv.nvmlDeviceGetEnforcedPowerLimit, h)
            gpus.append({
                "index": i,
                "name": self._s(self._try(nv.nvmlDeviceGetName, h) or "GPU"),
                "uuid": self._s(self._try(nv.nvmlDeviceGetUUID, h) or ""),
                "memory_total": mem.total if mem else 0,
                "power_limit_w": limit / 1000.0 if limit else None,
            })
        return {
            "gpu_driver": self._s(self._try(nv.nvmlSystemGetDriverVersion) or "") or None,
            "cuda_version": "%d.%d" % (cuda // 1000, (cuda % 1000) // 10) if cuda else None,
            "gpus": gpus,
        }

    def sample(self):
        nv, out = self.nv, []
        for i, h in enumerate(self.handles):
            util = self._try(nv.nvmlDeviceGetUtilizationRates, h)
            mem = self._try(nv.nvmlDeviceGetMemoryInfo, h)
            power = self._try(nv.nvmlDeviceGetPowerUsage, h)
            limit = self._try(nv.nvmlDeviceGetEnforcedPowerLimit, h)
            procs = self._try(nv.nvmlDeviceGetComputeRunningProcesses, h)
            out.append({
                "index": i,
                "utilization": float(util.gpu) if util else 0.0,
                "memory_used": mem.used if mem else 0,
                "memory_total": mem.total if mem else 0,
                "temperature_c": self._try(nv.nvmlDeviceGetTemperature, h, nv.NVML_TEMPERATURE_GPU),
                "power_w": round(power / 1000.0, 1) if power else None,
                "power_limit_w": limit / 1000.0 if limit else None,
                "fan_percent": self._try(nv.nvmlDeviceGetFanSpeed, h),
                "processes": len(procs) if procs is not None else None,
            })
        return out


class SmiGpus(object):
    backend = "nvidia-smi"
    FIELDS = "index,name,uuid,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed"

    def __init__(self):
        if not run(["nvidia-smi", "-L"]):
            raise RuntimeError("nvidia-smi unavailable")

    def _query(self):
        rows = []
        out = run(["nvidia-smi", "--query-gpu=" + self.FIELDS, "--format=csv,noheader,nounits"])
        for line in out.strip().splitlines():
            vals = [v.strip() for v in line.split(",")]
            if len(vals) == 10:
                rows.append(vals)
        return rows

    def static(self):
        driver = run(["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"]).strip().splitlines()
        cuda = None
        for line in run(["nvidia-smi"]).splitlines():
            if "CUDA Version:" in line:
                cuda = line.split("CUDA Version:")[1].split()[0]
                break
        gpus = [{
            "index": int(r[0]),
            "name": r[1],
            "uuid": r[2],
            "memory_total": int((to_float(r[5]) or 0) * 1024 * 1024),
            "power_limit_w": to_float(r[8]),
        } for r in self._query()]
        return {"gpu_driver": driver[0] if driver else None, "cuda_version": cuda, "gpus": gpus}

    def sample(self):
        mib = 1024 * 1024
        return [{
            "index": int(r[0]),
            "utilization": to_float(r[3]) or 0.0,
            "memory_used": int((to_float(r[4]) or 0) * mib),
            "memory_total": int((to_float(r[5]) or 0) * mib),
            "temperature_c": to_float(r[6]),
            "power_w": to_float(r[7]),
            "power_limit_w": to_float(r[8]),
            "fan_percent": to_float(r[9]),
            "processes": None,
        } for r in self._query()]


class NoGpus(object):
    backend = "none"

    def static(self):
        return {"gpu_driver": None, "cuda_version": None, "gpus": []}

    def sample(self):
        return []


def make_gpu_source():
    for cls in (NvmlGpus, SmiGpus):
        try:
            return cls()
        except Exception:
            continue
    return NoGpus()


# ---------------------------------------------------------------- main


def static_info(gpu):
    model, cores, threads = cpu_inventory()
    info = {
        "type": "static",
        "hostname": socket.gethostname(),
        "os_name": os_name(),
        "kernel": platform.release(),
        "arch": platform.machine(),
        "cpu_model": model,
        "cpu_cores": cores,
        "cpu_threads": threads,
        "mem_total": meminfo()["total"],
        "gpu_backend": gpu.backend,
        "interfaces": net_static(),
    }
    info.update(gpu.static())
    return info


def emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main():
    gpu = make_gpu_source()
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        info = static_info(gpu)
        info["python"] = platform.python_version()
        info["has_nvidia_smi"] = bool(run(["nvidia-smi", "-L"]))
        info["has_pynvml"] = gpu.backend == "pynvml"
        emit(info)
        return

    interval = max(float(sys.argv[1]) if len(sys.argv) > 1 else 2.0, 0.5)
    emit(static_info(gpu))
    prev_cpu, prev_net, prev_t = cpu_times(), net_counters(), time.time()
    time.sleep(min(interval, 1.0))
    while True:
        started = time.time()
        cur_cpu, cur_net = cpu_times(), net_counters()
        dt = max(started - prev_t, 1e-3)
        total_pct, per_core = cpu_percent(prev_cpu, cur_cpu)
        ifaces, rx_sum, tx_sum = [], 0.0, 0.0
        for name, (rx, tx) in sorted(cur_net.items()):
            prx, ptx = prev_net.get(name, (rx, tx))
            rx_bps, tx_bps = max(rx - prx, 0) / dt, max(tx - ptx, 0) / dt
            rx_sum += rx_bps
            tx_sum += tx_bps
            ifaces.append({"name": name, "rx_bps": round(rx_bps), "tx_bps": round(tx_bps), "rx_total": rx, "tx_total": tx})
        emit({
            "type": "sample",
            "uptime_s": uptime_s(),
            "cpu": {"percent": total_pct, "per_core": per_core, "load": list(os.getloadavg())},
            "memory": meminfo(),
            "gpus": gpu.sample(),
            "disks": disks(),
            "net": {"rx_bps": round(rx_sum), "tx_bps": round(tx_sum), "interfaces": ifaces},
        })
        prev_cpu, prev_net, prev_t = cur_cpu, cur_net, started
        time.sleep(max(interval - (time.time() - started), 0.05))


if __name__ == "__main__":
    try:
        main()
    except (BrokenPipeError, KeyboardInterrupt):
        pass
