// keyring.ts - System keyring access for secure credential storage

export class KeyringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyringError';
  }
}

/**
 * Restore console to normal state before exit
 */
function restoreConsole(): void {
  try {
    // Disable raw mode if enabled
    if (Deno.stdin.isTerminal()) {
      Deno.stdin.setRaw(false);
    }
  } catch {
    // Ignore - may not be in raw mode
  }

  // Show cursor, exit alternate screen, reset attributes
  const restore = [
    '\x1b[?25h',    // Show cursor
    '\x1b[?1049l',  // Exit alternate screen
    '\x1b[0m',      // Reset attributes
  ].join('');

  try {
    Deno.stdout.writeSync(new TextEncoder().encode(restore));
  } catch {
    // Ignore write errors
  }
}

export class Keyring {
  private service: string;
  private static _verified = false;

  constructor(service: string = "melker") {
    this.service = service;
  }

  /**
   * Check if the system keyring is available. Exits with error if not.
   */
  private async ensureAvailable(): Promise<void> {
    if (Keyring._verified) return;

    const os = Deno.build.os;
    let tool: string;
    let installHint: string;

    switch (os) {
      case "darwin":
        tool = "security";
        installHint = "The 'security' command should be available by default on macOS.";
        break;
      case "linux":
        tool = "secret-tool";
        installHint = "Install with: sudo apt install libsecret-tools (Debian/Ubuntu)\n             sudo dnf install libsecret (Fedora)\n             sudo pacman -S libsecret (Arch)";
        break;
      case "windows":
        tool = "powershell";
        installHint = "PowerShell should be available by default on Windows.";
        break;
      default:
        restoreConsole();
        console.error(`\n[FATAL] Unsupported operating system: ${os}`);
        console.error("Melker requires a system keyring for secure credential storage.");
        console.error("Supported platforms: macOS, Linux, Windows\n");
        Deno.exit(1);
    }

    try {
      // Just check if the command exists by running it with minimal args
      // secret-tool with no args prints usage to stdout and exits 2, but that's fine
      const cmd = new Deno.Command(tool, {
        args: [],
        stdout: "null",
        stderr: "null",
      });
      await cmd.output();
      // If we get here, the command exists (even if it returned non-zero)
    } catch {
      restoreConsole();
      console.error(`\n[FATAL] System keyring not available`);
      console.error(`Required tool '${tool}' not found or not functional.`);
      console.error(`\nMelker requires a system keyring for secure OAuth token storage.`);
      console.error(`\n${installHint}\n`);
      Deno.exit(1);
    }

    Keyring._verified = true;
  }

  async get(key: string): Promise<string | null> {
    await this.ensureAvailable();
    try {
      switch (Deno.build.os) {
        case "darwin":
          return await this.macosGet(key);
        case "linux":
          return await this.linuxGet(key);
        case "windows":
          return await this.windowsGet(key);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.ensureAvailable();
    switch (Deno.build.os) {
      case "darwin":
        await this.macosSet(key, value);
        break;
      case "linux":
        await this.linuxSet(key, value);
        break;
      case "windows":
        await this.windowsSet(key, value);
        break;
      default:
        throw new KeyringError(`Unsupported OS: ${Deno.build.os}`);
    }
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureAvailable();
    try {
      switch (Deno.build.os) {
        case "darwin":
          await this.macosDelete(key);
          break;
        case "linux":
          await this.linuxDelete(key);
          break;
        case "windows":
          await this.windowsDelete(key);
          break;
        default:
          return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // macOS - uses `security` CLI (Keychain)
  private async macosGet(key: string): Promise<string> {
    const cmd = new Deno.Command("security", {
      args: ["find-generic-password", "-s", this.service, "-a", key, "-w"],
    });
    const { success, stdout } = await cmd.output();
    if (!success) throw new Error("Not found");
    return new TextDecoder().decode(stdout).trim();
  }

  private async macosSet(key: string, value: string): Promise<void> {
    await this.macosDelete(key).catch(() => {});
    const cmd = new Deno.Command("security", {
      args: ["add-generic-password", "-s", this.service, "-a", key, "-w", value],
    });
    const { success } = await cmd.output();
    if (!success) throw new KeyringError("Failed to store credential in Keychain");
  }

  private async macosDelete(key: string): Promise<void> {
    const cmd = new Deno.Command("security", {
      args: ["delete-generic-password", "-s", this.service, "-a", key],
    });
    await cmd.output();
  }

  // Linux - uses `secret-tool` CLI (libsecret/GNOME Keyring)
  private async linuxGet(key: string): Promise<string> {
    const cmd = new Deno.Command("secret-tool", {
      args: ["lookup", "service", this.service, "key", key],
    });
    const { success, stdout } = await cmd.output();
    if (!success) throw new Error("Not found");
    return new TextDecoder().decode(stdout).trim();
  }

  private async linuxSet(key: string, value: string): Promise<void> {
    const cmd = new Deno.Command("secret-tool", {
      args: ["store", "--label", `${this.service}:${key}`, "service", this.service, "key", key],
      stdin: "piped",
    });
    const process = cmd.spawn();
    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(value));
    await writer.close();
    const { success } = await process.output();
    if (!success) throw new KeyringError("Failed to store credential in keyring");
  }

  private async linuxDelete(key: string): Promise<void> {
    const cmd = new Deno.Command("secret-tool", {
      args: ["clear", "service", this.service, "key", key],
    });
    await cmd.output();
  }

  // Windows - uses PowerShell with Windows Credential Manager
  private async windowsGet(key: string): Promise<string> {
    const simpleCmd = new Deno.Command("powershell", {
      args: ["-NoProfile", "-NonInteractive", "-Command", `
        [void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
        $vault = New-Object Windows.Security.Credentials.PasswordVault
        try {
          $cred = $vault.Retrieve('${this.service}', '${key}')
          $cred.RetrievePassword()
          Write-Output $cred.Password
        } catch { exit 1 }
      `],
    });
    const { success, stdout } = await simpleCmd.output();
    if (!success) throw new Error("Not found");
    return new TextDecoder().decode(stdout).trim();
  }

  private async windowsSet(key: string, value: string): Promise<void> {
    const cmd = new Deno.Command("powershell", {
      args: ["-NoProfile", "-NonInteractive", "-Command", `
        [void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
        $vault = New-Object Windows.Security.Credentials.PasswordVault
        try { $vault.Remove($vault.Retrieve('${this.service}', '${key}')) } catch {}
        $cred = New-Object Windows.Security.Credentials.PasswordCredential('${this.service}', '${key}', '${value.replace(/'/g, "''")}')
        $vault.Add($cred)
      `],
    });
    const { success } = await cmd.output();
    if (!success) throw new KeyringError("Failed to store credential in Windows Credential Manager");
  }

  private async windowsDelete(key: string): Promise<void> {
    const cmd = new Deno.Command("powershell", {
      args: ["-NoProfile", "-NonInteractive", "-Command", `
        [void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
        $vault = New-Object Windows.Security.Credentials.PasswordVault
        $cred = $vault.Retrieve('${this.service}', '${key}')
        $vault.Remove($cred)
      `],
    });
    await cmd.output();
  }
}
