# User disk quota panel

Open **Disk Quotas** in the sidebar (admin accounts only). Reports refresh once per
minute while the page is open; the backend caches a report for 30 seconds. Data comes
from Linux quota-tools `repquota`, including ext4/XFS user quotas supported by that
tool, not recursive `du` scans. Project/group quotas, ZFS datasets and directory size
limits are not user quotas and are not covered by this panel.

The backend needs Python 3 and quota-tools on the remote machine. The SSH login must
be root or be allowed to run this **exact read-only command** without a password:

```sh
/usr/sbin/repquota -a -u -n -p -v -O xml
```

If the installed path differs, use the path displayed in the panel. An administrator
can use `sudo visudo -f /etc/sudoers.d/lcc-quota` to add a rule like the following,
replacing `shuwenxue` with the configured server's SSH username:

```sudoers
shuwenxue ALL=(root) NOPASSWD: /usr/sbin/repquota -a -u -n -p -v -O xml
```

Then test as that SSH user:

```sh
sudo -n /usr/sbin/repquota -a -u -n -p -v -O xml
```

This feature does not install tools, edit sudoers, change limits, mount filesystems,
or turn quota accounting on. Those administrative changes must be done separately.
The configured quota must already be active. A successful empty report means no
records were found, not that all users consumed zero bytes. Permission errors and
other diagnostics produce an unavailable report instead of partial totals.

Byte figures are quota-accounted blocks (1 KiB units converted to bytes), not home
directory sizes. Inode limits/grace are displayed separately. A zero limit means
unlimited; soft limits may temporarily be exceeded during a grace period.

After installing this change, the backend must be restarted once to register the
new API. Plan that restart around open plain-shell terminals; the app does not
restart it automatically.
