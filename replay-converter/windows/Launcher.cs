using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyProduct(Program.Name)]
[assembly: AssemblyVersion("1.2.5.0")]

static class Program
{
    internal const string Name = "口嗨万智牌";

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
#if INSTALLER
            if (Array.IndexOf(args, "--quiet") >= 0) { Install(ResolveTarget(DefaultTarget()), false, null); return 0; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var window = new SetupWindow()) Application.Run(window);
#else
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Launch();
#endif
            return 0;
        }
        catch (Exception error)
        {
            if (Array.IndexOf(args, "--quiet") < 0) MessageBox.Show(error.Message, Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    static string Quote(string value) { return "\"" + value + "\""; }
    static string Local(string relative) { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), relative); }

#if INSTALLER
    const string InstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\EndstepReplayLab";
    const string FolderName = "EndstepReplayLab";
    const string PreviousName = "战报重演";
    static readonly string InstallLog = Local(@"EndstepReplayLab\install.log");

    static string DefaultTarget()
    {
        var overridePath = Environment.GetEnvironmentVariable("REPLAY_LAB_INSTALL_DIR");
        if (!String.IsNullOrWhiteSpace(overridePath)) return overridePath;
        using (var key = Registry.CurrentUser.OpenSubKey(InstallKey))
        {
            var previous = key == null ? null : key.GetValue("InstallLocation") as string;
            if (!String.IsNullOrWhiteSpace(previous)) return previous;
        }
        return Local(@"Programs\EndstepReplayLab");
    }

    static string ResolveTarget(string location)
    {
        location = Environment.ExpandEnvironmentVariables(location.Trim());
        if (!Regex.IsMatch(location, @"^[A-Za-z]:[\\/]") || location.IndexOfAny(Path.GetInvalidPathChars()) >= 0)
            throw new ArgumentException("请输入带盘符的本地绝对路径。");
        var absolute = Path.GetFullPath(location).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var leaf = Path.GetFileName(absolute);
        return Regex.IsMatch(leaf, @"^EndstepReplayLab([.-][\w.-]+)?$", RegexOptions.IgnoreCase)
            ? absolute : Path.Combine(absolute + Path.DirectorySeparatorChar, FolderName);
    }

    static void Install(string target, bool desktopShortcut, Action<string> report)
    {
        using (var mutex = new Mutex(false, @"Local\EndstepReplayLab-Setup"))
        {
            bool owned;
            try { owned = mutex.WaitOne(0); } catch (AbandonedMutexException) { owned = true; }
            if (!owned) throw new InvalidOperationException("另一个" + Name + "安装正在运行。");
            try { InstallFiles(target, desktopShortcut, report); }
            finally { mutex.ReleaseMutex(); }
        }
    }

    static void InstallFiles(string target, bool desktopShortcut, Action<string> report)
    {
        var temp = Path.Combine(Path.GetTempPath(), "EndstepReplayLab-" + Guid.NewGuid().ToString("N"));
        var logs = Local("EndstepReplayLab");
        Directory.CreateDirectory(temp);
        Directory.CreateDirectory(logs);
        try
        {
            var payload = Path.Combine(temp, "app.zip");
            var script = Path.Combine(temp, "install.ps1");
            Unpack("app.zip", payload);
            Unpack("install.ps1", script);
            var args = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(script)
                + " -Payload " + Quote(payload) + " -Target " + Quote(target);
            if (desktopShortcut) args += " -DesktopShortcut";
            if (Environment.GetEnvironmentVariable("REPLAY_LAB_NO_SHORTCUTS") == "1") args += " -NoShortcuts";
            var powershell = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
            var info = new ProcessStartInfo(powershell, args) {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = System.Text.Encoding.UTF8, StandardErrorEncoding = System.Text.Encoding.UTF8
            };
            using (var log = new StreamWriter(InstallLog))
            using (var process = new Process { StartInfo = info })
            {
                Action<string> write = line => {
                    if (String.IsNullOrWhiteSpace(line)) return;
                    lock (log) { log.WriteLine(line); log.Flush(); }
                    if (report != null) report(line);
                };
                process.OutputDataReceived += (sender, e) => write(e.Data);
                process.ErrorDataReceived += (sender, e) => write(e.Data);
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                if (process.ExitCode != 0) throw new InvalidOperationException("安装未完成。请检查下方提示或打开安装日志。");
            }
        }
        finally { try { Directory.Delete(temp, true); } catch (IOException) { } }
    }

    static void Unpack(string resource, string file)
    {
        using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource))
        using (var output = File.Create(file)) source.CopyTo(output);
    }

    sealed class SetupWindow : Form
    {
        readonly TextBox status;
        readonly TextBox location;
        readonly Label destination;
        readonly Button install, browse, cancel, openLog;
        readonly CheckBox desktopShortcut;
        readonly ProgressBar progress;
        string installedTarget;
        bool running, complete;

        public SetupWindow()
        {
            Text = Name + " 安装向导";
            ClientSize = new Size(610, 445);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 10);
            BackColor = Color.FromArgb(248, 247, 242);
            AutoScaleMode = AutoScaleMode.Dpi;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            var heading = new Label { Text = "安装" + Name, AutoSize = true, Font = new Font(Font.FontFamily, 21, FontStyle.Bold), Location = new Point(23, 18) };
            var introduction = new Label { Text = "当前用户安装，完成后可从开始菜单打开。\r\n安装包内置运行环境，安装时无需联网。", AutoSize = true, Location = new Point(25, 66) };
            var pathLabel = new Label { Text = "安装位置", AutoSize = true, Location = new Point(25, 117) };
            location = new TextBox { Name = "InstallLocation", Location = new Point(25, 141), Size = new Size(470, 29), Text = DefaultTarget() };
            browse = new Button { Text = "浏览…", Location = new Point(505, 139), Size = new Size(80, 30) };
            browse.Click += Browse;
            destination = new Label { Location = new Point(25, 175), Size = new Size(560, 40), ForeColor = Color.FromArgb(66, 88, 77) };
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            desktopShortcut = new CheckBox { Text = "创建桌面快捷方式", AutoSize = true, Location = new Point(25, 215),
                Checked = File.Exists(Path.Combine(desktop, Name + ".lnk")) || File.Exists(Path.Combine(desktop, PreviousName + ".lnk")) };
            progress = new ProgressBar { Location = new Point(25, 252), Size = new Size(560, 9) };
            status = new TextBox { ReadOnly = true, Multiline = true, ScrollBars = ScrollBars.Vertical, Location = new Point(25, 271), Size = new Size(560, 111), Text = "准备就绪。" };
            openLog = new Button { Text = "查看安装日志", Location = new Point(25, 395), Size = new Size(132, 33), Visible = false };
            openLog.Click += (sender, e) => { if (File.Exists(InstallLog)) Process.Start(InstallLog); };
            cancel = new Button { Text = "取消", Location = new Point(371, 395), Size = new Size(88, 33) };
            cancel.Click += (sender, e) => Close();
            install = new Button { Text = "安装", Location = new Point(467, 395), Size = new Size(118, 33), BackColor = Color.FromArgb(32, 78, 64), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
            install.Click += StartInstall;
            Controls.AddRange(new Control[] { heading, introduction, pathLabel, location, browse, destination, desktopShortcut, progress, status, openLog, cancel, install });
            location.TextChanged += (sender, e) => UpdateDestination();
            UpdateDestination();
            AcceptButton = install;
            FormClosing += (sender, e) => { if (running) e.Cancel = true; };
        }

        void UpdateDestination()
        {
            try { destination.Text = "最终目录  " + ResolveTarget(location.Text); install.Enabled = true; }
            catch (Exception error) { destination.Text = error.Message; install.Enabled = false; }
        }

        void Browse(object sender, EventArgs e)
        {
            using (var dialog = new FolderBrowserDialog { Description = "选择保存" + Name + "程序的文件夹", ShowNewFolderButton = true })
            {
                string parent = null;
                try { parent = Path.GetDirectoryName(ResolveTarget(location.Text)); } catch (ArgumentException) { } catch (NotSupportedException) { }
                if (Directory.Exists(parent)) dialog.SelectedPath = parent;
                if (dialog.ShowDialog(this) == DialogResult.OK) location.Text = dialog.SelectedPath;
            }
        }

        async void StartInstall(object sender, EventArgs e)
        {
            if (complete) { Process.Start(Path.Combine(installedTarget, "ReplayLab.exe")); Close(); return; }
            var target = ResolveTarget(location.Text);
            var createShortcut = desktopShortcut.Checked;
            running = true;
            location.Enabled = browse.Enabled = desktopShortcut.Enabled = cancel.Enabled = install.Enabled = false;
            openLog.Visible = false;
            progress.Style = ProgressBarStyle.Marquee;
            status.Clear();
            try
            {
                await Task.Run(() => Install(target, createShortcut, line => BeginInvoke((Action)(() => status.AppendText(line + Environment.NewLine)))));
                installedTarget = target;
                complete = true;
                install.Text = "打开应用";
                cancel.Text = "完成";
            }
            catch (Exception error)
            {
                status.AppendText(error.Message + Environment.NewLine);
                install.Text = "重试安装";
                openLog.Visible = File.Exists(InstallLog);
            }
            finally
            {
                running = false;
                progress.Style = ProgressBarStyle.Blocks;
                progress.Value = complete ? 100 : 0;
                location.Enabled = browse.Enabled = desktopShortcut.Enabled = !complete;
                cancel.Enabled = install.Enabled = true;
            }
        }
    }
#else
    sealed class Ready { public string url { get; set; } public int pid { get; set; } }

    static void Launch()
    {
        var root = AppDomain.CurrentDomain.BaseDirectory;
        var data = Local(@"EndstepReplayLab\data");
        Directory.CreateDirectory(data);
        var instance = "Local\\EndstepReplayLab-" + Environment.UserName;
        using (var reopen = new EventWaitHandle(false, EventResetMode.AutoReset, instance + "-Reopen"))
        using (var mutex = new Mutex(false, instance))
        {
            bool owned;
            try { owned = mutex.WaitOne(0); } catch (AbandonedMutexException) { owned = true; }
            if (!owned) { reopen.Set(); return; }
            try
            {
                var ready = Path.Combine(data, "ready-" + Guid.NewGuid().ToString("N") + ".json");
                var shutdown = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
                var info = new ProcessStartInfo(Path.Combine(root, "node.exe"), Quote(Path.Combine(root, @"replay-converter\server.js"))) {
                    WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true
                };
                info.EnvironmentVariables["REPLAY_LAB_READY"] = ready;
                info.EnvironmentVariables["REPLAY_LAB_SHUTDOWN"] = shutdown;
                info.EnvironmentVariables["REPLAY_LAB_DATA"] = data;
                var bundledRuntime = Path.Combine(root, "runtime");
                if (Directory.Exists(bundledRuntime)) info.EnvironmentVariables["ENDSTEP_FORGE_RUNTIME"] = bundledRuntime;
                using (var child = Process.Start(info))
                {
                    Ready location = null;
                    try
                    {
                        var started = Stopwatch.StartNew();
                        while (started.ElapsedMilliseconds < 20000 && !child.HasExited)
                        {
                            if (File.Exists(ready))
                            {
                                try { location = new JavaScriptSerializer().Deserialize<Ready>(File.ReadAllText(ready)); break; }
                                catch (IOException) { }
                                catch (ArgumentException) { }
                            }
                            Thread.Sleep(100);
                        }
                        Uri uri;
                        if (location == null || location.pid != child.Id || !Uri.TryCreate(location.url, UriKind.Absolute, out uri)
                            || uri.Scheme != "http" || uri.Host != "127.0.0.1")
                            throw new InvalidOperationException("应用未能启动。" + (child.HasExited ? child.StandardError.ReadToEnd() : ""));
                        RunWindowSession(data, uri, child, reopen);
                    }
                    finally
                    {
                        if (File.Exists(ready)) File.Delete(ready);
                        if (!child.HasExited && location != null)
                        {
                            try
                            {
                                var request = (HttpWebRequest)WebRequest.Create(location.url + "/shutdown");
                                request.Method = "POST";
                                request.Proxy = null;
                                request.ContentLength = 0;
                                request.Headers["Authorization"] = "Bearer " + shutdown;
                                request.Timeout = 3000;
                                request.GetResponse().Close();
                            }
                            catch (WebException) { }
                        }
                        if (!child.WaitForExit(4000)) child.Kill();
                    }
                }
            }
            finally { mutex.ReleaseMutex(); }
        }
    }

    static void RunWindowSession(string data, Uri uri, Process child, EventWaitHandle reopen)
    {
        var edge = FindEdge();
        if (edge == null) throw new InvalidOperationException("未找到 Microsoft Edge，无法打开应用窗口。");
        var args = "--no-first-run --disable-background-mode --user-data-dir=" + Quote(Path.Combine(data, "window")) + " --app=" + uri.AbsoluteUri;
        Action open = () => {
            using (Process.Start(new ProcessStartInfo(edge, args) { UseShellExecute = false })) { }
        };
        using (var session = new ApplicationContext())
        using (var menu = new ContextMenuStrip())
        using (var icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath))
        using (var tray = new NotifyIcon { Text = Name, Icon = icon ?? SystemIcons.Application, ContextMenuStrip = menu })
        using (var timer = new System.Windows.Forms.Timer { Interval = 300 })
        {
            EventHandler show = (sender, e) => {
                try { open(); }
                catch (Exception error) { MessageBox.Show(error.Message, Name, MessageBoxButtons.OK, MessageBoxIcon.Error); }
            };
            menu.Items.Add("打开" + Name, null, show);
            menu.Items.Add("退出" + Name, null, (sender, e) => session.ExitThread());
            tray.DoubleClick += show;
            timer.Tick += (sender, e) => {
                if (child.HasExited) { session.ExitThread(); return; }
                if (reopen.WaitOne(0)) show(sender, e);
            };
            open();
            tray.Visible = true;
            timer.Start();
            Application.Run(session);
            if (child.HasExited)
                throw new InvalidOperationException(Name + "的本机服务已停止。请从开始菜单重新打开。\n" + child.StandardError.ReadToEnd());
        }
    }

    static string FindEdge()
    {
        foreach (var folder in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Local("") })
        {
            var candidate = Path.Combine(folder, @"Microsoft\Edge\Application\msedge.exe");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
#endif
}
