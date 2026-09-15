use redis::aio::MultiplexedConnection;

pub struct RedisProcess {
    child: std::process::Child,
    socket: std::path::PathBuf,
}
impl Drop for RedisProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_file(&self.socket);
    }
}

pub async fn redis_process() -> (RedisProcess, MultiplexedConnection) {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nonce = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let socket = std::env::temp_dir().join(format!("ares-lb-{}-{nonce}.sock", std::process::id()));
    // macOS's default temp directory can exceed the Unix socket path limit.
    let socket = if socket.as_os_str().len() > 100 {
        std::path::PathBuf::from(format!("/tmp/ares-lb-{}-{nonce}.sock", std::process::id()))
    } else {
        socket
    };
    let child = std::process::Command::new("redis-server")
        .args([
            "--port",
            "0",
            "--save",
            "",
            "--appendonly",
            "no",
            "--unixsocket",
        ])
        .arg(&socket)
        .stdout(std::process::Stdio::null())
        .spawn()
        .expect("Redis integration tests require redis-server on PATH");
    let process = RedisProcess { child, socket };
    let client = redis::Client::open(format!("redis+unix://{}", process.socket.display())).unwrap();
    for _ in 0..100 {
        if let Ok(conn) = client.get_multiplexed_async_connection().await {
            return (process, conn);
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("isolated Redis did not start");
}
