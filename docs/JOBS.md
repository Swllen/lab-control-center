# Jobs and GPU allocation

## Submit an experiment

Open **Jobs → New job → Single job**:

| Field | Meaning / example |
|---|---|
| Name | `train-baseline` |
| Server | A real configured SSH server |
| GPUs | Count in Auto-assign mode; 0 means CPU-only |
| Working directory | Remote project path, e.g. `/home/labuser/project` |
| Command | Training command executed under `bash -l` |
| Environment variables | Optional `KEY=VALUE`, one per line |

Initialize conda explicitly; a non-interactive shell may not load your interactive setup:

```sh
source ~/miniconda3/etc/profile.d/conda.sh &&
conda activate training &&
python -u train.py --config configs/base.yaml
```

Or use the environment's Python directly:

```sh
/home/labuser/miniconda3/envs/training/bin/python -u train.py
```

Replace example paths/environment names with your own. Do not append `&`, wrap the
command in tmux/nohup, or override `CUDA_VISIBLE_DEVICES`: the scheduler manages
the command's lifetime and GPU assignment. The configured SSH account executes it,
which may differ from the person logged into the website.

## GPU policies

**Auto-assign** waits for the requested number of cards. **Select GPUs** uses only
the chosen physical indices and derives the count from your selection. Every chosen
card must be available; it never substitutes another card. Changing servers clears
the selection. Copy/retry and generated sweep jobs retain the selected indices.

CUDA renumbers visible cards inside the process: physical GPUs 2,3 normally become
`cuda:0`, `cuda:1`. Requesting multiple cards does not make a single-GPU script
distributed automatically; configure the training launcher yourself.

Default availability means memory ≤10%, utilization ≤15%, and no reservation by a
running control-center job. Checks run every 5 seconds, require live online telemetry
and respect the server's concurrent-job limit. There is no sustained-idle requirement
or OS-level lock against other users' manually launched processes. Waiting jobs show
a reason; later jobs may start if they fit other resources.

## Status and logs

| Status | Meaning |
|---|---|
| Queued | Waiting for telemetry, GPUs or a concurrency slot |
| Running | Remote wrapper launched with PID recorded |
| Completed | Exit code 0 |
| Failed | Launch error, nonzero exit or disappeared process |
| Canceled | Stopped by an operator; history remains |

Open task details for stdout/stderr. `python -u` avoids buffered Python output.
Progress is not inferred from arbitrary logs; write `0.42` or `42%` to
`$LCC_PROGRESS_FILE` to report it.

Remote `~/.lcc/jobs/<id>/` contains `run.sh`, `stdout.log`, `stderr.log`, `pid`,
and eventually `exit_code`. Models/checkpoints use the paths in your command/config;
relative paths usually resolve against Working directory.

## Cancel, retry and history cleanup

- **Cancel:** stop the process group (TERM, then KILL after a delay), keeping history/files.
- **Retry:** reuse the ID and GPU policy; output for that ID is overwritten on the next run.
- **Duplicate:** create another queued task with copied settings.
- **Delete selected:** after confirmation, remove finished history records only.
  Running/queued records are protected. Remote logs and checkpoints remain.
  Selection applies to records shown under the current filters, not the entire database.

## Parameter sweeps

Choose **New sweep**, with YAML such as:

```yaml
parameters:
  learning_rate: [0.0001, 0.0003]
  batch_size: [4, 8]
```

Command:

```sh
python -u train.py --lr {learning_rate} --batch-size {batch_size}
```

Preview expands the Cartesian product: four jobs here. Parameters not referenced
by placeholders are appended as `--parameter=value`. Jobs pinned to the same cards
must wait for them in turn.

## Troubleshooting

- **Exit 127:** inspect stderr; check executable paths, conda setup and project paths.
- **Queued indefinitely:** inspect the wait reason, GPU usage thresholds, live metrics
  and `max_jobs` in the server configuration.
- **Select GPUs unavailable:** restart the updated backend to load the additive
  migration/capability. Plan around open plain shells.
- **Browser closed:** launched jobs run detached remotely; queueing and monitoring
  require the backend to keep running. Restarting it pauses scheduling until reconnect.
