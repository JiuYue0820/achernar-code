$ErrorActionPreference = 'Stop'
if ($env:ACHERNAR_JOB_TRACE -eq '1') { [Console]::Error.WriteLine('Achernar job: helper started') }
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# One JSON frame. Waiting for EOF can stall on inherited Windows pipe handles.
$config = [Console]::In.ReadLine() | ConvertFrom-Json
if ($config.trace) { [Console]::Error.WriteLine('Achernar job: input received') }
$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class AchernarJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
    public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct Counters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public Basic Basic; public Counters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int Size; public string Reserved, Desktop, Title;
    public uint X,Y,Width,Height,CharsX,CharsY,Fill,Flags;
    public ushort Show, ReservedSize; public IntPtr Reserved2, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref Limits data, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string text) {
    var result = new StringBuilder("\""); int slashes = 0;
    foreach (char ch in text) {
      if (ch == '\\') { slashes++; continue; }
      if (ch == '"') { result.Append('\\', slashes*2+1); result.Append(ch); }
      else { result.Append('\\', slashes); result.Append(ch); }
      slashes=0;
    }
    result.Append('\\',slashes*2); return result.Append('"').ToString();
  }
  public static int Run(string executable, string[] args, string cwd, uint processes, ulong memoryBytes, bool trace) {
    if (trace) Console.Error.WriteLine("Achernar job: creating job");
    IntPtr job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
    ProcessInfo info = new ProcessInfo(); bool resumed = false;
    try {
      var limits = new Limits();
      limits.Basic.Flags = 0x2000 | 0x200 | 0x8 | 0x400; // kill on close, job memory, process count, no crash UI
      limits.Basic.ActiveProcesses = processes; limits.JobMemory = new UIntPtr(memoryBytes);
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(Limits))));
      var startup = new Startup(); startup.Size = Marshal.SizeOf(typeof(Startup)); startup.Flags=0x101;
      startup.Input=GetStdHandle(-10); startup.Output=GetStdHandle(-11); startup.Error=GetStdHandle(-12);
      foreach (IntPtr handle in new [] { startup.Input, startup.Output, startup.Error })
        if (handle != IntPtr.Zero && handle != new IntPtr(-1)) Check(SetHandleInformation(handle, 1, 1));
      var command = new StringBuilder(Quote(executable));
      if (System.IO.Path.GetFileName(executable).Equals("cmd.exe", StringComparison.OrdinalIgnoreCase)
          && args.Length == 4 && args[0] == "/d" && args[1] == "/s" && args[2] == "/c") {
        // cmd parses the /c tail itself; CRT argv escaping changes its quotes.
        command.Append(" /d /s /c \"").Append(args[3]).Append('"');
      } else {
        foreach (string arg in args) command.Append(" ").Append(Quote(arg));
      }
      Check(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x4 | 0x08000000, IntPtr.Zero, cwd, ref startup, out info));
      if (trace) Console.Error.WriteLine("Achernar job: suspended process created");
      // No code runs before assignment. Assignment failure never falls back to an unrestricted process.
      Check(AssignProcessToJobObject(job, info.Process));
      if (trace) Console.Error.WriteLine("Achernar job: process assigned");
      Check(ResumeThread(info.Thread) != 0xffffffff); resumed = true;
      if (trace) Console.Error.WriteLine("Achernar job: process resumed");
      Check(WaitForSingleObject(info.Process, 0xffffffff) == 0);
      if (trace) Console.Error.WriteLine("Achernar job: process exited");
      uint exit; Check(GetExitCodeProcess(info.Process, out exit)); return unchecked((int)exit);
    } finally {
      if (!resumed && info.Process != IntPtr.Zero) TerminateProcess(info.Process, 1);
      CloseHandle(job); // Any descendants still running are terminated.
      if (info.Thread != IntPtr.Zero) CloseHandle(info.Thread);
      if (info.Process != IntPtr.Zero) CloseHandle(info.Process);
    }
  }
}
'@
# Add-Type compiles through TEMP. An inherited system TEMP (C:\Windows\Temp) can lose the
# generated .cs file before csc reads it, so retry once in the per-user temp folder.
try { Add-Type -TypeDefinition $source } catch {
  $userTemp = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Temp'
  if (-not (Test-Path -LiteralPath $userTemp -PathType Container) -or $env:TEMP -eq $userTemp) { throw }
  if ($config.trace) { [Console]::Error.WriteLine('Achernar job: retrying compile in user temp') }
  $env:TEMP = $userTemp; $env:TMP = $userTemp
  Add-Type -TypeDefinition $source
}
if ($config.trace) { [Console]::Error.WriteLine('Achernar job: helper compiled') }
try {
  $executable = (Get-Command -Name $config.command -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  if ($config.trace) { [Console]::Error.WriteLine('Achernar job: executable resolved') }
  $result = [AchernarJob]::Run($executable, [string[]]$config.args, [string]$config.cwd, [uint32]$config.processes, [uint64]$config.memoryBytes, [bool]$config.trace)
  exit $result
} catch {
  [Console]::Error.WriteLine('Windows Job Object could not execute the command; no host fallback: ' + $_.Exception.Message)
  exit 126
}
